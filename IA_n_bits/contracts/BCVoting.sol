pragma solidity ^0.5.8;
pragma experimental ABIEncoderV2;

import { BN } from "./lib/BN.sol";
import { Bytes } from "./lib/Bytes.sol";
import { Memory } from "./lib/Memory.sol";


/*
 * @title BCVoting
 *
 *  @author: anonymous voter
 */
contract BCVoting {

  // using Bytes for bytes;

  uint constant MIN_DEPOSIT_AUTHORITY = 10000;
  uint constant DEPOSIT_VOTER = 1000;
  uint constant MOD_MAX = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

  string[] public candidates; // this represents all candidates for elections/voting. Note that 32B is the limitation for description of each candidate.
  address public authority;
  BN.instance public P; // public modulus
  BN.instance public Pminus1;
  uint public sizeP;
  uint public sizeHash; //size derived from public modulus (in Bytes)
  uint[] tally; // results of voting; associated with candidates

  // Voter[] public voters; // Data of eligible voters.
  mapping (address => uint) public deposits; // Deposits serve for handling cases such as misbehaving authority or non-voting participants
  StageEnum public stage;

  // Crypto stuff
  BN.instance[] public ephemeralPKs; // items are G^x; array is indexed by idx of voter present in idxVoters mapping.
  BN.instance[] public MpcPKs; // items are G^y
  BN.instance[] public blindedVotes;
  BN.instance[] public candidatesG; // generators for candidates (denoted as f)
  BN.instance[] public modInvCGens; // cache of modular inverse for cand generators
  BN.instance public G; // common generator for voters.

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

  // EVENTS
  event SingUpFinished(BN.instance[] submittedEphPKs);
  event VotingFinished(BN.instance[] submittedVotes);
  event TallyCompleted(uint[] tally);
  event ArraysCompared(bytes a1, bytes a2);
  event MPCKeysComputedEvent(BN.instance[] mpcPKs);
  event FirstConditionEvent(BN.instance left, BN.instance right);
  event HashInputEvent(bytes input);

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

  constructor(
    string[] memory _candidates, uint[] memory _cand_generators, bytes[] memory _cand_gen_inv,
    bytes memory modulus_v,
    uint _voters_G,
    uint _deltaT,
    uint _sizeP
  )
    public
  {
    authority = msg.sender;

    require(_cand_generators.length == _candidates.length, "Candidates and generators must have the same length");
    // require(BN.checkMainGenerator(_voters_G, modulus), "Voters' generator does not meet conditions.");
    P = BN.instance(modulus_v, false, getBitLen(modulus_v));
    Pminus1 = BN.prepare_sub(P, BN.instance(abi.encodePacked(uint(0x01)), false, 1));
    sizeP = _sizeP;
    sizeHash = sizeP + 2; // add one extra byte due to substraction of sum
    G = BN.instance(abi.encodePacked(_voters_G), false, getBitLenUint(_voters_G));
    deltaT = _deltaT;

    usedGens[_voters_G] = true;
    for (uint i = 0; i < _candidates.length; i++) {
      candidates.push(_candidates[i]);
      // require(BN.checkGenerator(_cand_generators[i], modulus), "Candidates' generators do not meet conditions."); TODO: later
      require(!usedGens[_cand_generators[i]], "Candidate generators contain a duplicity.");
      usedGens[_cand_generators[i]] = true;
      candidatesG.push(BN.instance(abi.encodePacked(_cand_generators[i]), false, getBitLenUint(_cand_generators[i])));

      BN.instance memory invcg_BN =  BN.instance(_cand_gen_inv[i], false, getBitLen(_cand_gen_inv[i]));
      BN.mod_inverse(candidatesG[candidatesG.length - 1], P, invcg_BN);
      modInvCGens.push(invcg_BN);
    }

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
  function submitEphemeralPK(bytes memory ephemeralKey, uint ephKeyLen) public payable
    isVoterEligible(msg.sender)
    inStage(StageEnum.SIGNUP)
    checkDepositSentByVoter()
  {

    BN.instance memory bni = BN.instance(ephemeralKey, false, ephKeyLen);

    require(BN.cmp(bni, P, false) < 0, "Ephemeral key of a voter does not fit the modulus.");
    idxVoters[msg.sender] = ephemeralPKs.length;
    ephemeralPKs.push(bni); // @IH: no other checks for validity of the ephemeral key?


    require(BN.cmp(ephemeralPKs[idxVoters[msg.sender]], bni, false) == 0, "submitEphemeralPK: wrongly initialized BN");
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
  function computeMPCKeys(bytes[] memory inv_result, uint[] memory inv_result_len) public
    verifySigAuthority()
    inStage(StageEnum.PRE_VOTING)
  {
    require(!expiredTimeout(timeout_PreVoting), "PreVoting timeout expired");

    BN.instance[] memory right_table = new BN.instance[](ephemeralPKs.length);
    right_table[ephemeralPKs.length - 1] = BN.instance(abi.encodePacked(uint(0x01)), false, 1);

    // precompute the product of the denominator part: prod of G ^x_j for the first voter
    for (uint j = 1; j < ephemeralPKs.length; j++) {
      right_table[ephemeralPKs.length - j - 1] = BN.modmul(right_table[ephemeralPKs.length - j], ephemeralPKs[ephemeralPKs.length - j], P);
    }

    BN.instance memory act_left = BN.instance(abi.encodePacked(uint(0x01)), false, 1);
    for(uint i = 0; i < ephemeralPKs.length; i++) {

      if(0 != i){ // accumulate prod of  G ^ x_j, starting by the first voter
        act_left = BN.modmul(act_left, ephemeralPKs[i - 1], P);
      }

      BN.instance memory tmpRes = BN.instance(inv_result[i], false, inv_result_len[i]);
      MpcPKs.push(BN.modmul(act_left, BN.mod_inverse(right_table[i], P, tmpRes), P));
    }

    stage = StageEnum.VOTING;
    timeout_Voting = now + deltaT;
    emit MPCKeysComputedEvent(MpcPKs);
  }


  /**
   * Called by participants.
   * Each item of proof pi_l = {a, b, r, d}
   */
  function submitVote(
    bytes[] memory proof_a,
    bytes[] memory proof_b,
    bytes[] memory proof_r,
    bytes[] memory proof_d,
    bytes memory vote
  ) public
    voterSubmittedEphPK(msg.sender)
    inStage(StageEnum.VOTING)
  {
    require(!expiredTimeout(timeout_Voting), "Voting timeout expired.");
    require(proof_a.length == candidates.length
            && proof_b.length == proof_a.length
            && proof_r.length == proof_a.length
            && proof_d.length == proof_a.length,
            "The size of the proof does not match the number of candidates."
    );

    verifyHashAndABs(proof_a, proof_b, proof_d); // ~200k of gas
    BN.instance memory bnvote = BN.instance(vote, false, getBitLen(vote));

    checkVotersProof(proof_a, proof_b, proof_r, proof_d, bnvote); // 1.1M

    // store vote
    blindedVotes.push(bnvote);

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
    BN.instance memory left = BN.instance(abi.encodePacked(uint(0x01)), false, 1);
    for (uint i = 0; i < blindedVotes.length; i++) {
      left = BN.modmul(left, blindedVotes[i], P);
    }

    BN.instance memory right = BN.instance(abi.encodePacked(uint(0x01)), false, 1);
    BN.instance memory cBN;
    for (uint l = 0; l < candidates.length; l++) {
      cBN = BN.instance(abi.encodePacked(c[l]), false, getBitLenUint(c[l]));
      right =  BN.modmul(right, BN.prepare_modexp(candidatesG[l], cBN, P), P);
      tally[l] = c[l];
    }
    require(0 == BN.cmp(left, right, false), "Incorrect tally values were provided.");

    // Inform voters
    emit TallyCompleted(tally);
  }

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

  function getEphPK(uint idx) public view returns (bytes memory) {
    require(idx < ephemeralPKs.length, "out of range");
    return ephemeralPKs[idx].val;
  }

  function getMPCPK(uint idx) public view returns (bytes memory) {
    require(idx < MpcPKs.length, "out of range");
    return MpcPKs[idx].val;
  }

  function getBlindedVote(uint idx) public view returns (bytes memory) {
    require(idx < blindedVotes.length, "out of range");
    return blindedVotes[idx].val;
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

  function getSizeOfHashFittingModulus(BN.instance memory m) internal pure returns (uint) {
    if(m.bitlen % 8 != 0 ){
      return (m.bitlen / 8) + 1;
    }else{
      return m.bitlen / 8;
    }
  }

  function getBitLenUint(uint a) internal pure returns (uint){

    uint r = a;
    uint len = 0;
    while(r > 0){
      r = r / 2;
      len++;
    }
    return len;
  }

  // function getBitLen(bytes memory arr) internal pure returns (uint){
  //   uint len = arr.length * 8;

  //   uint tmpBitLen = 0;
  //   for (uint i = arr.length - 1 ; tmpBitLen == 0  && i > 0; i--) {
  //     tmpBitLen = getBitLen(uint(uint8(arr[i])));
  //     len -= (8 - tmpBitLen);
  //   }
  //   return len;
  // }

  function getBitLen(bytes memory arr) internal pure returns (uint){
    uint len = arr.length * 8;

    uint tmpBitLen = 0;
    for (uint i = 0; tmpBitLen == 0  && i < arr.length; i++) {
      tmpBitLen = getBitLenUint(uint(uint8(arr[i])));
      len -= (8 - tmpBitLen);
    }
    return len;
  }

  /**
   * Computes hash with arbitrary length of output that fits sizeBytes
   */
  function shaX(bytes memory arg, uint sizeBytes) public pure returns (bytes memory){

    bytes32 tmpHash = keccak256(arg);
    bytes memory retHash = new bytes(sizeBytes);

    uint fullBlks = sizeBytes / 32;

    for(uint h = 0; h < fullBlks; h++){

      // copy full 32B blocks
      for (uint i = 0; i < 32; i++) {
        retHash[(h * 32) + i] = tmpHash[i];
      }
      tmpHash = keccak256(abi.encodePacked(tmpHash));
    }

    // copy the rest (<= 32B)
    for (uint i = 0; i < sizeBytes % 32; i++) {
      retHash[fullBlks * 32 + i] = tmpHash[i];
    }

    return retHash;

    // bytes32 tmpHash = keccak256(arg);
    // bytes memory retHash = abi.encodePacked(tmpHash);

    // for (uint i = 1; i < sizeBytes / 32; i++) {
    //   tmpHash = keccak256(abi.encodePacked(tmpHash));
    //   retHash = Bytes.concat(retHash, abi.encodePacked(tmpHash));
    // }
    // if(sizeBytes % 32 != 0){
    //   tmpHash = keccak256(abi.encodePacked(tmpHash));
    //   bytes memory partOfHash = Bytes.substr(abi.encodePacked(tmpHash), 0, sizeBytes % 32);
    //   retHash = Bytes.concat(retHash, partOfHash); // add remaining bytes
    // }
    // return retHash;
  }


  function  buildInputForHash(bytes[] memory proof_a, bytes[] memory proof_b) internal view returns (bytes memory){

    bytes memory inpForHash = new bytes(2 * (proof_a.length * sizeP));
    for (uint i = 0; i < proof_a.length; i++) {
      for (uint j = 0; j < sizeP; j++) {
        inpForHash[(sizeP * i) + j] = proof_a[i][j];
      }
    }
    for (uint i = proof_a.length; i < 2 * proof_b.length; i++) {
      for (uint j = 0; j < sizeP; j++) {
        inpForHash[(sizeP * i) + j] = proof_b[i - proof_a.length][j];
      }
    }
    return inpForHash;
  }

  function  verifyHashAndABs(bytes[] memory proof_a, bytes[] memory proof_b, bytes[] memory proof_d) internal view {

    BN.instance memory dsum = BN.instance(abi.encodePacked(uint(0x00)), false, 1);
    for (uint i = 0; i < candidates.length; i++) {
      dsum = BN.prepare_add(dsum, BN.instance(proof_d[i], false, getBitLen(proof_d[i])));
    }
    dsum = BN.bn_mod(dsum, Pminus1);


    bytes memory inpForHash = buildInputForHash(proof_a, proof_b);
    // emit HashInputEvent(inpForHash);

    bytes memory hashBytes = shaX(inpForHash, sizeHash);
    BN.instance memory cmodP = BN.bn_mod(BN.instance(hashBytes, false, getBitLen(hashBytes)), Pminus1);
    // emit ArraysCompared(cmodP.val, dsum.val);
    require(0 == BN.cmp(cmodP, dsum, false), "C does not match SUM of 'd's.");
  }

  function checkVotersProof(
    bytes[] memory proof_a,
    bytes[] memory proof_b,
    bytes[] memory proof_r,
    bytes[] memory proof_d,
    BN.instance memory bnvote
  ) internal view
  {
    BN.instance memory proof_a_BN;
    BN.instance memory proof_b_BN;
    BN.instance memory proof_r_BN;
    BN.instance memory proof_d_BN;
    BN.instance memory left;
    BN.instance memory right;

    uint idxVoter = idxVoters[msg.sender];

    for (uint l = 0; l < candidates.length; l++) {

      //   // 1) g^{r_l} == a_l * x^{d_l}
      //   //    where x := g^{x_i}    (ephemeral PK)
      proof_a_BN = BN.instance(proof_a[l], false, getBitLen(proof_a[l]));
      proof_b_BN = BN.instance(proof_b[l], false, getBitLen(proof_b[l]));
      proof_r_BN = BN.instance(proof_r[l], false, getBitLen(proof_r[l]));
      proof_d_BN = BN.instance(proof_d[l], false, getBitLen(proof_d[l]));

      left = BN.prepare_modexp(G, proof_r_BN, P);
      right = BN.prepare_modexp(ephemeralPKs[idxVoter], proof_d_BN, P);
      right = BN.modmul(right, proof_a_BN, P);
      // emit FirstConditionEvent(left, right);
      require(0 == BN.cmp(left, right, false), "Proof verification failed at 1st condition.");


      //   // 2) h^{r_l} == b_l(B_i / f_l)^{d_l}
      //   //    where B_i := h^{x_i} * f_l (blinded vote)  && h := g^{y_i}  (MPC PK)
      left = BN.prepare_modexp(MpcPKs[idxVoter], proof_r_BN, P);
      right = BN.modmul(bnvote, modInvCGens[l], P);
      right = BN.prepare_modexp(right, proof_d_BN, P);
      right = BN.modmul(right, proof_b_BN, P);
      require(0 == BN.cmp(left, right, false), "Proof verification failed at 2nd condition.");
    }
  }

}
