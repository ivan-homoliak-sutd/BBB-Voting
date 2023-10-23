pragma solidity ^0.5.8;
pragma experimental ABIEncoderV2;

// import { ECCMath } from "./lib/ECCMath.sol";
// import { Secp256k1 } from "./lib/Secp256k1.sol";
import { CMath } from "./lib/CMath.sol";


/*
 * @title BCVoting
 *
 *  @description: TODO
 *  @author: anonymous voter
 */
contract BCVoting {

  uint constant MIN_DEPOSIT_AUTHORITY = 10000;
  uint constant DEPOSIT_VOTER = 1000;
  uint constant MOD_MAX = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

  string[] public candidates; // this represents all candidates for elections/voting. Note that 32B is the limitation for description of each candidate.
  address public authority;
  uint public P; // public modulus
  uint public sizeHash; //size derived from public modulus (in Bytes)
  uint[] tally; // results of voting; associated with candidates

  // Voter[] public voters; // Data of eligible voters.
  mapping (address => uint) public deposits; // Deposits serve for handling cases such as misbehaving authority or non-voting participants
  StageEnum public stage;

  // Crypto stuff
  uint[] public ephemeralPKs; // items are G^x; array is indexed by idx of voter present in idxVoters mapping.
  uint[] public MpcPKs; // items are G^y
  uint[] public blindedVotes;
  uint[] public candidatesG; // generators for candidates (denoted as f)
  uint   public G; // common generator for voters: TODO: change

  // Timeouts
  uint public timeout_SignUp;
  uint public timeout_PreVoting;
  uint public timeout_Voting;
  uint public deltaT; // step for timouts

  // AUX stuff
  address[] public eligibleVotersAddrs; // addresses of all eligible voters
  mapping (address => bool) public votersWithEphKey; // mapping of voters that submitted eph. keys
  mapping (address => bool) public eligibleVoters; // mapping of addresses of voters (for fast lookup)
  mapping (address => uint) public idxVoters; // mapping of addresses of voters to index in ephemeralPKs array (for fast access)
  mapping (uint => bool) usedGens;
  enum StageEnum { SETUP,  SIGNUP, PRE_VOTING, VOTING, TALLY}
  // uint[] powersOfG;

  // struct Voter {
  //   address addr;
  //   // uint ephemeralKey;
  //   uint mpcPK;
  //   uint vote;
  //   bytes32 commitment;
  // }

  // EVENTS
  event SingUpFinished(uint[] submittedEphPKs);
  event VotingFinished(uint[] submittedVotes);
  event TallyCompleted(uint[] tally);
  event ArraysCompared(bytes a1, bytes a2);
  event MPCKeysComputedEvent(uint[] mpcPKs);
  event FirstConditionEvent(uint left, uint right);

  // MODIFIERS
  modifier verifySigAuthority() {
      require(msg.sender == authority, "Only authority can call this function.");
      _;
  }
  modifier isVoterEligible(address voter) {
      require(eligibleVoters[voter], "Not Eligible voter.");
      _;
  }
  modifier voterSubmittedEphPK(address voter) {
      require(votersWithEphKey[voter], "Voter does not submitted eph. key.");
      _;
  }
  modifier inStage(StageEnum _stage) {
      require(_stage == stage, "Wrong stage detected.");
      _;
  }
  modifier checkDepositSentByAuthority() {
    require(msg.value >= MIN_DEPOSIT_AUTHORITY, "Not enough deposit sent by authority.");
      _;
  }
  modifier checkDepositSentByVoter() {
    require(msg.value == DEPOSIT_VOTER, "Incorrect deposit sent by a voter.");
      _;
  }

  ///////////// Transaction-Based Methods ////////////////

  constructor(string[] memory _candidates, uint[] memory _cand_generators, uint modulus, uint _voters_G, uint _deltaT) public {
    authority = msg.sender;

    require(_cand_generators.length == _candidates.length, "Candidates and generators must have the same length");
    require(modulus < MOD_MAX, "Public modulus is out-of-range.");
    // require(CMath.checkMainGenerator(_voters_G, modulus), "Voters' generator does not meet conditions.");
    P = modulus;
    sizeHash = getSizeOfHashFittingModulus(P);
    G = _voters_G;
    deltaT = _deltaT;

    usedGens[G] = true;
    for (uint i = 0; i < _candidates.length; i++) {
      candidates.push(_candidates[i]);
      require(_cand_generators[i] < MOD_MAX, "Candidate generators do not fit the maximum allowed modulus.");
      require(CMath.checkGenerator(_cand_generators[i], modulus), "Candidates' generators do not meet conditions.");
      require(!usedGens[_cand_generators[i]], "Candidate generators contain a duplicity.");
      usedGens[_cand_generators[i]] = true;
      candidatesG.push(_cand_generators[i]);
    }
    // computeCacheofPowers(G, powersOfG);

    tally.length = candidates.length;
    stage = StageEnum.SETUP;
  }

  /**
   * Called by authority
   * We suppose that authority already verified identity of voters and ownership of SKs associated with addresses (even though they might not exist on Eth yet)
   * Moreover, authority puts deposit here.
   */
  function enrollVoters(address[] memory _voters) public payable
    verifySigAuthority()
    inStage(StageEnum.SETUP)
    checkDepositSentByAuthority()
  {
    for (uint i = 0; i < _voters.length; i++) {
      eligibleVoters[_voters[i]] = true;
      eligibleVotersAddrs.push(_voters[i]);
    }
    deposits[authority] = msg.value;
    stage = StageEnum.SIGNUP;

    timeout_SignUp = now + _voters.length * deltaT; // prolong time with the number of voters
  }

  /**
   * Called by voters
   * By submission of eph. PK, voters agree with the parameters of the election (i.e., validity of candidates & generators of candidates)
   * Moreover, voters put deposit here.
   */
  function submitEphemeralPK(uint ephemeralKey) public payable
    isVoterEligible(msg.sender)
    inStage(StageEnum.SIGNUP)
    checkDepositSentByVoter()
  {
    // uint idx = idxVoters[msg.sender];
    require(ephemeralKey < P, "Ephemeral key of a voter does not fit the modulus.");
    idxVoters[msg.sender] = ephemeralPKs.length;
    ephemeralPKs.push(ephemeralKey); // @IH: no other checks for validity of the ephemeral key?
    deposits[msg.sender] += msg.value;
    votersWithEphKey[msg.sender] = true;

    // if all voters submitted keys, then change the stage and broadcast all eph. PKs.
    if(ephemeralPKs.length == eligibleVotersAddrs.length){
        stage = StageEnum.PRE_VOTING;
        timeout_PreVoting = now + deltaT;
        emit SingUpFinished(ephemeralPKs);
    }
  }

  /**
   * Called by anybody (in the case not all eligible voters submited their eph. PKs during the timeout)
   */
  function changeStageToPreVoting() public
    inStage(StageEnum.SIGNUP)
  {
     require(expiredTimeout(timeout_SignUp), "Sing-up timeout has not expired yet.");
     stage = StageEnum.PRE_VOTING;
     emit SingUpFinished(ephemeralPKs);
     timeout_PreVoting = now + deltaT;
  }

  /**
   * Called by authority to compute MPC keys. If not called in time, then voters get deposit of authority.
   */
  function computeMPCKeys() public
    verifySigAuthority()
    inStage(StageEnum.PRE_VOTING)
  {
    require(!expiredTimeout(timeout_PreVoting), "PreVoting timeout expired");

    for (uint i = 0; i < ephemeralPKs.length; i++) {

      uint numerator = 1;
      for (uint j = 0; j < i; j++) {
        numerator = CMath.mul_mod(numerator, ephemeralPKs[j], P);
      }

      uint denominator = 1;
      for (uint j = i + 1; j < ephemeralPKs.length; j++) {
        denominator = CMath.mul_mod(denominator, ephemeralPKs[j], P);
      }
      MpcPKs.push(CMath.mul_mod(numerator, CMath.inv_mod(denominator, P), P));
    }
    stage = StageEnum.VOTING;
    timeout_Voting = now + deltaT;
    emit MPCKeysComputedEvent(MpcPKs);
  }

  /**
   * Called by participants.
   * Each item of proof pi_l = {a, b, r, d}
   */
  function submitVote(uint vote, uint[] memory proof_a, uint[] memory proof_b, uint[] memory proof_r, uint[] memory proof_d) public
    voterSubmittedEphPK(msg.sender)
    inStage(StageEnum.VOTING)
  {
    require(!expiredTimeout(timeout_Voting), "Voting timeout expired.");
    require(proof_a.length == candidates.length &&
            proof_b.length == candidates.length &&
            proof_r.length == candidates.length &&
            proof_d.length == candidates.length,
            "The size of the proof does not match the number of candidates."
    );

    uint dxor = 0; // xor of d_l paramteres
    for (uint i = 0; i < candidates.length; i++) {
      dxor = dxor ^ proof_d[i];
    }

    bytes32 hash = keccak256(abi.encodePacked(proof_a, proof_b));
    bytes memory hashAsBytes = abi.encodePacked(hash);

    // emit ArraysCompared(hashAsBytes, truncateLeadingZeros(bytes32(proof_c), sizeHash));
    // require(areArraysEqual(truncate(hashAsBytes, sizeHash), truncateLeadingZeros(bytes32(proof_c), sizeHash)), "Incorrect hash of 'a's and 'b's.");
    // require(dxor == proof_c, "C does not match XOR of 'd's.");
    require(areArraysEqual(truncate(hashAsBytes, sizeHash), truncateLeadingZeros(bytes32(dxor), sizeHash)), "C does not match XOR of 'd's.");

    uint idxVoter = idxVoters[msg.sender];

    for (uint l = 0; l < candidates.length; l++) {

      // 1) g^{r_l} == a_l * x^{d_l}
      //    where x := g^{x_i}    (ephemeral PK)
      uint left = CMath.exp_mod(G, proof_r[l], P);
      uint right = CMath.exp_mod(ephemeralPKs[idxVoter], proof_d[l], P);
      right = CMath.mul_mod(right, proof_a[l], P);
      // emit FirstConditionEvent(left, right);
      require(left == right, "Proof verification failed at 1st condition.");

      // 2) h^{r_l} == b_l(B_i / f_l)^{d_l}
      //    where B_i := h^{x_i} * f_l (blinded vote)  && h := g^{y_i}  (MPC PK)
      left = CMath.exp_mod(MpcPKs[idxVoter], proof_r[l], P);
      right = CMath.mul_mod(vote, CMath.inv_mod(candidatesG[l], P), P);
      right = CMath.exp_mod(right, proof_d[l], P);
      right = CMath.mul_mod(right, proof_b[l], P);


      // 2) modified: h^{r_l} * f_l^{d_l} == b_l * B_i^{d_l}   => more expensive by ~400k
      //
      // left = CMath.exp_mod(MpcPKs[idxVoter], proof_r[l], P);
      // left =  CMath.mul_mod(left, CMath.exp_mod(candidatesG[l], proof_d[l], P), P);
      // right = CMath.exp_mod(vote, proof_d[l], P);
      // right = CMath.mul_mod(right, proof_b[l], P);

      require(left == right, "Proof verification failed at 2nd condition.");
    }

    // store vote
    blindedVotes.push(vote);

    // shift stage if all participants voted
    if (blindedVotes.length == ephemeralPKs.length) {
      stage = StageEnum.TALLY;
      emit VotingFinished(blindedVotes);
    }
  }

  /**
   * Called by anybody (in the case not all voters with eph. PKs submited their votes during the voting timeout)
   */
  function changeStageToTally() public
    inStage(StageEnum.VOTING)
  {
     require(expiredTimeout(timeout_Voting), "Voting timeout has not expired yet.");
     stage = StageEnum.TALLY;
     emit VotingFinished(blindedVotes);
  }

  /**
   * Called by authority
   */
  function computeTally(uint[] memory c) public
    verifySigAuthority()
    inStage(StageEnum.TALLY)
  {
    require(candidates.length == c.length, "C array has incorrect length.");

    // Verify that product of Bi == f_1^{c_1} * f_2^{c_2} * ... * f_k^{c_k}
    uint left = CMath.prod_mod(blindedVotes, P);
    uint right = 1;
    for (uint l = 0; l < candidates.length; l++) {
      right = (right *  CMath.exp_mod(candidatesG[l], c[l], P)) % P;
      tally[l] = c[l];
    }
    require(left == right, "Incorrect tally values were provided.");

    // Inform voters
    emit TallyCompleted(tally);
  }


  /**
   * Called by anybody if the system is stranded in a state with expired timeout.
   *
   */
  // function resetState() public {
  //   if (StageEnum.PRE_VOTING == stage && expiredTimeout(timeout_PreVoting)) {

  //   } else {

  //   }
  // }


  ///////////// Call-Based Methods (not modifying the state) ////////////////

  function getCntOfEligibleVoters() public view returns (uint) {
        return eligibleVotersAddrs.length;
  }

  function getCntOfCandidates() public view returns (uint) {
        return candidates.length;
  }

  function getCntOfEphPKs() public view returns (uint) {
        return ephemeralPKs.length;
  }

  function getCntOfMpcPKs() public view returns (uint) {
        return MpcPKs.length;
  }

  function getCntOfBlinedVotes() public view returns (uint) {
        return blindedVotes.length;
  }

  function expiredTimeout(uint t) public view returns (bool) {
    if(now > t){
      return true;
    }
    return false;
  }

  /**
   * Fit the hash size to size (in Bytes) by truncating it
   */
  function truncate(bytes memory hash, uint size) internal pure returns (bytes memory) {
    bytes memory ret = new bytes(size);
    for(uint i = 0; i < size; i++) {
      ret[i] = hash[i];
    }
    return ret;
  }

  function truncateLeadingZeros(bytes32 arg, uint size) internal pure returns (bytes memory) {
    bytes32 shiftedArg = arg << (256 - (size * 8));
    bytes memory tmp = abi.encodePacked(shiftedArg);
    return truncate(tmp, size);
  }

  function areArraysEqual(bytes memory a, bytes memory b) internal pure returns (bool) {

    if(a.length != b.length){
      return false;
    }

    for(uint i = 0; i < a.length; i++) {
      if(a[i] != b[i]){
        return false;
      }
    }
    return true;
  }

  function getSizeOfHashFittingModulus(uint m) internal pure returns (uint) {
    uint tmp = m;
    uint bits = 0;
    while (tmp > 0) {
        tmp = tmp / 2;
        bits += 1;
    }
    if(bits % 8 != 0 ){
      return (bits / 8) + 1;
    }else{
      return bits / 8;
    }
  }

  // function computeCacheofPowers(uint a, uint[] storage cache) internal {
  //   uint res = a;
  //   cache.push(res);

  //   for (uint i = 0; i < 128; i++) {
  //     res = (res * res) % P;
  //     cache.push(res);
  //   }
  // }

  // function getVoter(uint idx) public view
  //   returns (address _address, uint[2] memory _ephemeralKey, uint[2] memory _mpcPK, bytes32 _commitment)
  // {
  //     _address = voters[idx].addr;
  //     // _ephemeralKey = voters[idx].ephemeralKey;
  //     _ephemeralKey = ephemeralPKs[idx];
  //     _mpcPK = voters[idx].mpcPK;
  //     _commitment = voters[idx].commitment;
  // }
}
