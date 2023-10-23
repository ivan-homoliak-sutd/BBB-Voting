pragma solidity >=0.5.8 <0.8.0;
// pragma solidity ^0.5.8;
pragma experimental ABIEncoderV2;

import { EC } from "./lib/EC.sol";
import { FastEcMul } from "./lib/FastEcMul.sol";

/*
 * @title BCVoting
 *
 *  @description: TODO
 *  @author: anonymous voter
 *  SPDX-License-Identifier: MIT
 */
contract BCVoting {

  uint constant MIN_DEPOSIT_AUTHORITY = 10000;
  uint constant DEPOSIT_VOTER = 1000;
  uint constant MOD_MAX = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

  string[] public candidates; // this represents all candidates for elections/voting. Note that 32B is the limitation for description of each candidate.
  address public authority;
  uint public sizeHash; //size derived from public modulus (in Bytes)
  int[] tally; // results of voting; associated with candidates

  // Voter[] public voters; // Data of eligible voters.
  mapping (address => uint) public deposits; // Deposits serve for handling cases such as misbehaving authority or non-voting participants
  StageEnum public stage;

  // Secp256k1 curve parameters
  uint[2] public G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8]; // common generator for voters - base points
  uint public NN = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141; // modulus for private keys (i.e., order of G)
  uint public PP = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F; // modulus for public keys (i.e., field size)
  uint public A = 0;
  uint public B = 7;
  uint public Lambda = 0x5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72; // a root of the characteristic polynomial of the endomorphism of the curve
  uint public Beta = 0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee; // constant on the curve (endomorphism)

  // Other Crypto stuff
  uint[2][] public ephemeralPKs; // items are G^x; array is indexed by idx of voter present in idxVoters mapping.
  uint[2][] public MpcPKs; // items are G^y (or yG for EC)
  // uint[] public MpcPKsTmp; // only for debug purposes; delete later
  // uint[] public blindedVotes; // it contains pairs
  mapping(uint => uint[2]) public blindedVotes;
  uint blindedVotesCnt = 0; // counter of blinded votes submitted
  uint[2][] public candidatesG; // generators for candidates (denoted as f)
  uint[] public notVotedIdxs; // idx of voters who did not voted despite submitting ephemeral PK

  // Timeouts
  uint public timeout_SignUp;
  uint public timeout_PreVoting;
  uint public timeout_Voting;
  uint public deltaT; // step for timeouts

  // AUX stuff
  address[] public eligibleVotersAddrs; // addresses of all eligible voters
  mapping (address => bool) public votersWithEphKey; // mapping of voters that submitted eph. keys
  mapping (address => bool) public eligibleVoters; // mapping of addresses of voters (for fast lookup)
  mapping (address => uint) public idxVoters; // mapping of addresses of voters to index in ephemeralPKs array (for fast access)
  // mapping (uint => bool) public votersVoted; // indication which voters already voted
  mapping (uint => bool) public submitted_BlindedKeys;
  uint submittedVotersFT = 0;


  mapping (uint => bool) usedGens;
  enum StageEnum { SETUP,  SIGNUP, PRE_VOTING, VOTING, FT_RESOLUTION, TALLY}

  // State preservation for batching of MPC key computation
  uint public MPC_start = 0; // idx of the voter that is at the begining of batching sliding window
  uint public MPC_batch; // the size of the batch
  uint[3] public MPC_act_left = [G[0], G[1], 1];
  uint[3][] public MPC_right_markers;

  // EVENTS
  event SingUpFinished();
  // event VotingFinished(uint[] submittedVotePairs);
  event TallyCompleted(int[] tally);
  event ArraysCompared(bytes a1, bytes a2);
  event MPCKeysComputedEvent(uint[] mpcKeys1D);
  event MPCKeysComputedEvent();
  event HashComputedEvent(uint h);
  event FirstConditionEvent(uint[3] left, uint[3] right);
  event VotingExpiredWithMissingVotes(uint[] notVotedIdxs);
  event RepairedBVoteEvent(uint[2] blindedVote);  

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
  modifier voterVoted(address voter, uint myIdx) {      
      require(idxVoters[voter] == myIdx, "Submitted index does not correspond to the address of voter.");
      require(blindedVotes[myIdx][0] != 0, "Voter did not vote.");      
      _;
  }  
  modifier isVoterMissing(uint faultyIdx) {            
      require(blindedVotes[faultyIdx][0] == 0, "Voter marked as faulty is not faulty.");      
      _;
  }    
  modifier notSubmittedBlindingKeyYet(uint myIdx) {            
      require(!submitted_BlindedKeys[myIdx], "Voter already submitted blinding key.");      
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

  constructor(string[] memory _candidates, uint[] memory _cand_generators, uint _deltaT, uint _mpc_batch_size) public {
    authority = msg.sender;

    require(_cand_generators.length == _candidates.length * 2, "Candidates and generators must have the same length");
    deltaT = _deltaT;
    MPC_batch = _mpc_batch_size;

    // usedGens[G] = true;
    for (uint i = 0; i < _candidates.length; i++) {
      candidates.push(_candidates[i]);
      // TBD: handle duplicities
      // require(_cand_generators[i] < MOD_MAX, "Candidate generators do not fit the maximum allowed modulus.");
      // require(CMath.checkGenerator(_cand_generators[i], modulus), "Candidates' generators do not meet conditions.");
      // require(!usedGens[_cand_generators[i]], "Candidate generators contain a duplicity.");
      // usedGens[_cand_generators[i]] = true;
      candidatesG.push([_cand_generators[i * 2], _cand_generators[i * 2 + 1]]); // extract consecutive pairs of x_i,y_i values from 1D array
      require(EC.isOnCurve(candidatesG[candidatesG.length - 1][0], candidatesG[candidatesG.length - 1][1], A, B, PP), "Candidate generator must be on the curve.");
      tally.push(0); // alocate dynamic array :\
    }    
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
      require(! eligibleVoters[_voters[i]], "Voter already exists.");
      eligibleVoters[_voters[i]] = true;
      eligibleVotersAddrs.push(_voters[i]);
    }
    deposits[authority] = msg.value;
    stage = StageEnum.SIGNUP;

    timeout_SignUp = block.timestamp + _voters.length * deltaT; // prolong time with the number of voters
  }

  /**
   * Called by voters
   * By submission of eph. PK, voters agree with the parameters of the election (i.e., validity of candidates & generators of candidates)
   * Moreover, voters put deposit here.
   */
  function submitEphemeralPK(uint[2] memory ephemeralKey) public payable
    isVoterEligible(msg.sender)
    inStage(StageEnum.SIGNUP)
    checkDepositSentByVoter()
  {
    require(EC.isOnCurve(ephemeralKey[0], ephemeralKey[1], A, B, PP), "Ephemeral PK of the voter must be on the curve.");
    idxVoters[msg.sender] = ephemeralPKs.length;
    ephemeralPKs.push(ephemeralKey); // @IH: no other checks for validity of the ephemeral key?
    deposits[msg.sender] += msg.value;
    votersWithEphKey[msg.sender] = true;    

    // if all voters submitted keys, then change the stage and broadcast all eph. PKs.
    if(ephemeralPKs.length == eligibleVotersAddrs.length){
        stage = StageEnum.PRE_VOTING;
        timeout_PreVoting = block.timestamp + deltaT;
        emit SingUpFinished();
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
     emit SingUpFinished();
     timeout_PreVoting = block.timestamp + deltaT;
  }

  /**
   * Called by authority to prepare array of right-markers for MPC key computation - this resolves time-space tradeoff.
   */
  function buildRightMarkers4MPC() public
    verifySigAuthority()
    inStage(StageEnum.PRE_VOTING)
  {
    require(0 == MPC_start && 0 == MPC_right_markers.length, "Righ markers has already been built.");
    require(ephemeralPKs.length >= MPC_batch, "MPC batch size is higher than the number of voters (should be equal or lower). ");

    // build the markers in the right table only at the begining, while right table would be built always for relevant voters only (using the markers)
    uint[3] memory right_tmp = [G[0], G[1], 1];

    if(0 != ephemeralPKs.length % MPC_batch){ // deal with a special case where ephemeralPKs.length is not divisible by the batch size
      MPC_right_markers.push(right_tmp);
    }

    // continue with additions to compute the values of penultimate voter and so on, until the 1st voter is reached
    for (uint j = 1; j < ephemeralPKs.length; j++) {

      if((ephemeralPKs.length % MPC_batch) == (j - 1) % MPC_batch){ // store marker since it marks the begining of the batch
        MPC_right_markers.push(right_tmp);
      }

      // continue in additions to the right item in MPC expression
      (right_tmp[0], right_tmp[1], right_tmp[2]) = EC.OVN_addMixed(
        right_tmp,
        ephemeralPKs[ephemeralPKs.length - j], A, PP
      );
    }
  }

  /**
   * Called (repeatably) by authority to compute MPC keys. If not called in time, then voters get deposit of authority.
   */
  function computeMPCKeys(uint[] memory inv_mod_mpc2, uint[] memory inv_mod_mpc1) public
    verifySigAuthority()
    inStage(StageEnum.PRE_VOTING)
  {
    require(!expiredTimeout(timeout_PreVoting), "PreVoting timeout expired");
    require(0 != MPC_right_markers.length, "Righ markers has not been built yet.");
    require(MPC_batch == inv_mod_mpc1.length || ephemeralPKs.length % MPC_batch == inv_mod_mpc1.length, "Length of mod inverse cache array 1 is wrong.");
    require(MPC_batch == inv_mod_mpc2.length || ephemeralPKs.length % MPC_batch == inv_mod_mpc2.length, "Length of mod inverse cache array 2 is wrong.");

    uint[3] memory act_left_m = MPC_act_left;
    uint[3][] memory right_table = new uint[3][](MPC_batch);

    // build the right table using markers created before
    uint skipOffset = 0;
    if(MPC_start + MPC_batch > ephemeralPKs.length){ // skipoffset only applies in the last batch of the case where MPC_batch does not divide ephemeralPKs.length
      skipOffset = (MPC_batch - ephemeralPKs.length % MPC_batch);
    }
    right_table[MPC_batch - skipOffset - 1] = MPC_right_markers[MPC_right_markers.length - MPC_start / MPC_batch - 1];

    for (uint j = 1 + skipOffset; j < MPC_batch; j++) {
      uint idx = MPC_batch - j;

      (right_table[idx - 1][0],
        right_table[idx - 1][1],
        right_table[idx - 1][2]
      ) = EC.OVN_addMixed(
        right_table[idx],
        ephemeralPKs[MPC_start + idx], A, PP
      );
    }

    // handle the end bound for the main cycle
    uint end_bound = MPC_start + MPC_batch;
    if(end_bound > ephemeralPKs.length){
      end_bound = ephemeralPKs.length;
    }

    uint[3] memory res;
    // the main cycle processing the actual batch of voters
    for (uint i = MPC_start; i < end_bound; i++) {

      if(0 != i){ // accumulate sum of x_j * G, starting by the first voter
        (act_left_m[0], act_left_m[1], act_left_m[2]) = EC.OVN_addMixed(act_left_m, ephemeralPKs[i - 1], A, PP);
      }

      // Finally, we do substraction (left - right)
      (res[0], res[1], res[2]) = EC.ecSub_J_optim(act_left_m[0], act_left_m[1], act_left_m[2],
        right_table[i % MPC_batch][0],
        right_table[i % MPC_batch][1],
        right_table[i % MPC_batch][2],
        inv_mod_mpc1[i - MPC_start],
        PP
      );
      (res[0], res[1], res[2]) = EC.toAffine3_optim(res[0], res[1], res[2], inv_mod_mpc2[i - MPC_start], PP);

      MpcPKs.push([res[0], res[1]]);
      // MpcPKsTmp.push(res[0]); //TODO remove later
      // MpcPKsTmp.push(res[1]);
    }
    MPC_act_left = act_left_m; // update state of MPC batch sliding window at storage
    MPC_start = MPC_start + MPC_batch;

    // all batches were processed
    if(end_bound == ephemeralPKs.length){
      MPC_start = 0; // reset for the next stage // maybe drop - it is required only for re-voting
      stage = StageEnum.VOTING;
      timeout_Voting = block.timestamp + deltaT;
    }
    // emit MPCKeysComputedEvent(MpcPKsTmp);
    emit MPCKeysComputedEvent();
  }

  /**
   * Called by participants.
   * Each item of proof pi_l = {a, b, r_decomposed, d_decomposed}
   * Modular inversions are packed in triplets, respecting the main cycle
   */
  function submitVote(uint[] memory proof_A, uint[] memory proof_B,
    int[] memory proof_r, int[] memory proof_d, uint[2] memory vote, uint[] memory mod_invs
  ) public
    voterSubmittedEphPK(msg.sender)
    inStage(StageEnum.VOTING)
  {
    require(!expiredTimeout(timeout_Voting), "Voting timeout expired.");
    require(proof_A.length == 2 * candidates.length &&
            proof_B.length == 2 * candidates.length &&
            proof_r.length == 2 * candidates.length &&
            proof_d.length == 2 * candidates.length, // contains decomposed scalars as well as their original form to make XOR efficient
            "The size of the proof does not match the number of candidates."
    );

    uint dxor = 0; // xor of d_l paramteres
    for (uint i = 0; i < candidates.length; i++) {
      uint proof_d_full;
      // compute d = d1+d2*LAMBDA (mod n) to ensure consistency as part of later hash verification
      if(proof_d[2 * i + 1] < 0){
        proof_d_full = NN - mulmod(uint(-proof_d[2 * i + 1]), Lambda, NN);
      }else{
        proof_d_full = mulmod(uint(proof_d[2 * i + 1]), Lambda, NN);
      }

      if(proof_d[2 * i] < 0){
        proof_d_full = addmod(NN + uint(-proof_d[2 * i]), proof_d_full, NN);
      }else{
        proof_d_full = addmod(uint(proof_d[2 * i]), proof_d_full, NN);
      }

      dxor = dxor ^ proof_d_full;
    }
    require(areArraysEqual(
      truncate(abi.encodePacked(keccak256(abi.encodePacked(proof_A, proof_B))), sizeHash),
      truncateLeadingZeros(bytes32(dxor), sizeHash)),
      "C does not match XOR of 'd's."
    );

    uint idxVoter = idxVoters[msg.sender];
    uint[3] memory left;
    uint[6] memory right; // right[3-5] is another tmp variable (since stack deep error occurs; allowing only 16 local vars and func params)

    for (uint l = 0; l < candidates.length; l++) {

      ///////////////////////////////////
      // 1) g * {r_l} - X * {d_l} == a_l
      //    where X := g * x_i    (ephemeral PK)
      (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[2 * l], proof_r[2 * l + 1], -proof_d[2 * l], -proof_d[2 * l + 1]],
          [G[0], G[1], 1, ephemeralPKs[idxVoter][0], ephemeralPKs[idxVoter][1], 1],
          A, Beta, PP
      );
      (left[0], left[1], left[2]) = EC.toAffine3_optim(left[0], left[1], left[2], mod_invs[l * 3], PP);
      // emit FirstConditionEvent(left, [right[0], right[1], right[2]]);
      require(left[0] == proof_A[2 * l] && left[1] == proof_A[2 * l + 1], "Proof verification failed at the 1st condition.");

      ///////////////////////////////////
      // 2) h * {r_l} + d_l * f_l == b_l + d_l * B_l            // (h = g * Y)
      (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[2 * l], proof_r[2 * l + 1], proof_d[2 * l], proof_d[2 * l + 1]],
          [MpcPKs[idxVoter][0], MpcPKs[idxVoter][1], 1, candidatesG[l][0], candidatesG[l][1], 1],
          A, Beta, PP
      );
      (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
          [proof_d[2 * l], proof_d[2 * l + 1], 0, 0],
          [vote[0], vote[1], 1, G[0], G[1], 1],
          A, Beta, PP
      );
      (right[0], right[1], right[2]) = EC.OVN_addMixed(
          [right[0], right[1], right[2]],
          [proof_B[2 * l], proof_B[2 * l + 1]],
          A, PP
      );

      (left[0], left[1], left[2]) = EC.toAffine3_optim(left[0], left[1], left[2], mod_invs[l * 3 + 1], PP);
      (right[0], right[1], right[2]) = EC.toAffine3_optim(right[0], right[1], right[2], mod_invs[l * 3 + 2], PP);
      require(left[0] == right[0] && left[1] == right[1], "Proof verification failed at 2nd condition.");
    }

    // store vote
    blindedVotes[idxVoter] = [vote[0], vote[1]];    
    blindedVotesCnt += 1;
    // votersVoted[idxVoter] = true; // mark voter as already voted

    // shift stage to TALLY if all participants voted 
    if (blindedVotesCnt == ephemeralPKs.length) {
      stage = StageEnum.TALLY;
      // emit VotingFinished(blindedVotes);
    }
  }

  /**
   * Called by anybody to shift the stage into FT resolution (in the case not all voters with eph. PKs submited their votes during the voting timeout)
   */
  function changeStageToFT_Resolution() public
    inStage(StageEnum.VOTING)
  {
    require(expiredTimeout(timeout_Voting), "Voting timeout has not expired yet.");
    stage = StageEnum.FT_RESOLUTION;

    for (uint i = 0; i < ephemeralPKs.length; i++) {
      if(blindedVotes[i][0] == 0){
        notVotedIdxs.push(i); 
      }           
    }      
    // timeout_FT_Resolution = block.timestamp + deltaT;
    emit VotingExpiredWithMissingVotes(notVotedIdxs);
  }

  /**
   * Called by a particular participant P_i to repair her blinded vote by adding/subtracting secret blinded key G * x_i * x_j shared 
   * with the non-voting participant P_j from P_i's vote
   * Verification of correspondence G * x_i * x_j to G * x_i and G * x_j must be done in zero knowledge before modifiyng the vote.
   * 
   * faultyIdx: is sorted array of all faulty idxs (sorting is required by uniqueness check)
   * blindedKeys: contains pairs (i.e., points)
   * proof_r: contains decomposed scalars
   * proof_{m1, m2}: contain pairs (i.e., points)
   * h_decomp: decomposed h(A, B, m1, m2)
   * mod_invs: precomputed modular inverses required at aaffine transformation
   */
  function FT_repairBlindedVote(uint[] memory mod_invs,
                                int[] memory proof_r, int[] memory h_decomp, 
                                uint[] memory proof_m1, uint[] memory proof_m2,  uint[] memory blindedKeys, uint[] memory faultyIdx, uint myIdx                                
  ) public
    inStage(StageEnum.FT_RESOLUTION)  
    // voterVoted(msg.sender, myIdx) // this modifier cannot be used directly since it contributes to # of local vars and thus => "stack too deep error"
    notSubmittedBlindingKeyYet(myIdx)      
  {        
    require(idxVoters[msg.sender] == myIdx, "Submitted index does not correspond to the address of voter."); 
    require(blindedVotes[myIdx][0] != 0, "Voter did not vote.");       

    //  require(!expiredTimeout(timeout_FT_Resolution), "Timeout for FT resolution is expired.");
    require(faultyIdx.length * 2 == blindedKeys.length);            
    
    for (uint f = 0; f < faultyIdx.length; f++) {
      require(blindedVotes[faultyIdx[f]][0] == 0, "Voter marked as faulty is not faulty.");      
      
      FT_verifyZKP(
                    [mod_invs[f * 2], mod_invs[f * 2 + 1]],
                    ephemeralPKs[myIdx], ephemeralPKs[faultyIdx[f]],                                   
                    [proof_r[2 * f], proof_r[2 * f + 1]],
                    [h_decomp[2 * f], h_decomp[2 * f + 1]],
                    [proof_m1[2 * f], proof_m1[2 * f + 1]],
                    [proof_m2[2 * f], proof_m2[2 * f + 1]],
                    [blindedKeys[2 * f], blindedKeys[2 * f + 1]]
                                  
      );      

      if(faultyIdx[f] < myIdx){ // blinded key has positive sign (it is on the left from my index) => we need to subtract it from blinded vote
          (blindedKeys[2 * f], blindedKeys[2 * f + 1]) = EC.ecInv(blindedKeys[2 * f], blindedKeys[2 * f + 1], PP);
      }// else{} // blinded key has negative sign (it is on the right from my index) => we need to add it to blinded vote      
      (blindedVotes[myIdx][0], blindedVotes[myIdx][1]) = EC.ecAdd(
            blindedVotes[myIdx][0], blindedVotes[myIdx][1],
            blindedKeys[2 * f], blindedKeys[2 * f + 1],
            A, PP
      );         

      if(f > 0 && faultyIdx[f - 1] >= faultyIdx[f]){ // ascended ordering must be preserved
        revert("Ascended ordering of faulty indices must be preserved.");
      }
    }
    require(faultyIdx.length == notVotedIdxs.length, "Not all faulty IDXes were processed.");
    
    submittedVotersFT += 1;
    submitted_BlindedKeys[myIdx] = true;
    if(ephemeralPKs.length - notVotedIdxs.length == submittedVotersFT){
        stage = StageEnum.TALLY;
    }
    emit RepairedBVoteEvent(blindedVotes[myIdx]);  
  }
  
  function FT_verifyZKP(uint[2] memory mod_invs, uint[2] storage I, uint[2] storage J, 
                        int[2] memory proof_r,  int[2] memory h_decomp, // decomposed scalars
                        uint[2] memory proof_m1, uint[2] memory proof_m2,
                        uint[2] memory blindedKey) private
  {
    uint[3] memory left;    
    uint h = uint(keccak256(abi.encodePacked(I, J, proof_m1, proof_m2)));
    emit HashComputedEvent(h);

    ///////////////////////////////////
    // 1)   G * r - I * h == m1      // original is G * r == m1 + I * h        
    (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[0], proof_r[1], -h_decomp[0], -h_decomp[1]],
          [G[0], G[1], 1, I[0], I[1], 1],
          A, Beta, PP
    );
    (left[0], left[1], left[2]) = EC.toAffine3_optim(left[0], left[1], left[2], mod_invs[0], PP);        
    require(left[0] == proof_m1[0] && left[1] == proof_m1[1], "FT Proof verification failed at the 1st condition.");
    
    ///////////////////////////////////
    // 2)  J * r - C * h = m2        // original is J * r = m2 + C * h     (C = blinding key = G * x_i * x_j)    
    (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[0], proof_r[1], -h_decomp[0], -h_decomp[1]],
          [J[0], J[1], 1, blindedKey[0], blindedKey[1], 1],
          A, Beta, PP
    );
    (left[0], left[1], left[2]) = EC.toAffine3_optim(left[0], left[1], left[2],  mod_invs[1], PP);                   
    // emit ArraysCompared(abi.encodePacked(left[0], left[1]), abi.encodePacked(right[0], right[1]));    
    require(left[0] == proof_m2[0] && left[1] == proof_m2[1], "FT Proof verification failed at the 2nd condition.");
  }

  /**
   * Called by authority. However, it could be called by anybody.
   */
  function computeTally(int[] memory c_decom, uint[2] memory modinv) public
    verifySigAuthority()
    inStage(StageEnum.TALLY)
  {
    require(candidates.length * 2 == c_decom.length, "C array has incorrect length.");

    // Verify that sum of B_i == f_1 * c_1 + f_2 * c_2 * ... * f_k * c_k
    
    // Compute Sum of B_i
    uint[3] memory left = [G[0], G[1], 1];
    for (uint i = 0; i < ephemeralPKs.length; i++) {
      if(blindedVotes[i][0] == 0){
        continue;
      }      
      (left[0], left[1], left[2]) = EC.OVN_addMixed(
          [left[0], left[1], left[2]],
          [blindedVotes[i][0], blindedVotes[i][1]],
          A, PP
      );
    }

    // Compute sum of counts * gens (right side)
    uint[3] memory sum = [G[0], G[1], 1];
    uint[3] memory right;
    for (uint l = 0; l < candidatesG.length; l += 2) { // pairwise iteration
      if(l == candidatesG.length - 1){ // in the case of the odd number of candidates, use neutral feature as the second item for multiplication when processing the last candidate
        (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
            [c_decom[2 * l], c_decom[2 * l + 1], 0, 0], // take two consecutive decomposed scalars (consisting of 4 items)
            [candidatesG[l][0], candidatesG[l][1], 1, G[0], G[1], 1], // take 2 consecutive candidate gens
            A, Beta, PP
        );
      }else{ // all other iterations
        (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
            [c_decom[2 * l], c_decom[2 * l + 1], c_decom[2 * l + 2], c_decom[2 * l + 3]], // take two consecutive decomposed scalars (consisting of 4 items)
            [candidatesG[l][0], candidatesG[l][1], 1, candidatesG[l + 1][0], candidatesG[l + 1][1], 1], // take 2 consecutive candidate gens
            A, Beta, PP
        );
        tally[l + 1] = c_decom[2 * l + 2] * c_decom[2 * l + 3]; // (2nd cand in the pair) // this can be switched of as an gas optimization
      }
      tally[l] = c_decom[2 * l] * c_decom[2 * l + 1]; // (1st cand in the pair) // this can be switched of as an gas optimization                
      
      (sum[0], sum[1], sum[2]) = EC.jacAdd(
          sum[0], sum[1], sum[2],
          right[0], right[1], right[2],
          PP
      );                        
    }
    
    (left[0], left[1], left[2]) = EC.toAffine3_optim(left[0], left[1], left[2], modinv[0], PP);                   
    (sum[0], sum[1], sum[2]) = EC.toAffine3_optim(sum[0], sum[1], sum[2], modinv[1], PP);                   
    require(left[0] == sum[0] && left[1] == sum[1], "Incorrect tally values were provided.");

    // Inform voters
    emit TallyCompleted(tally);
  }

  // ///////////// Call-Based Methods (not modifying the state) ////////////////

  function getCntOfEligibleVoters() public view returns (uint) {
        return eligibleVotersAddrs.length;
  }

  function getCntOfCandidates() public view returns (uint) {
        return candidates.length;
  }

  function getCntOfEphPKs() public view returns (uint) {
        return ephemeralPKs.length;
  }

  function getCntOfMarkersMPC() public view returns (uint) {
        return MPC_right_markers.length;
  }

  function getCntOfMpcPKs() public view returns (uint) {
        return MpcPKs.length;
  }

  function getCntOfBlinedVotes() public view returns (uint) {
        return blindedVotesCnt;
  }
  function getBlinedVote(uint idx) public view returns (uint[2] memory) {
        return [blindedVotes[idx][0], blindedVotes[idx][1]];
  }

  function expiredTimeout(uint t) public view returns (bool) {
    if(block.timestamp > t){
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

  function modInvCache4MPCBatched(uint start_idx, uint[3] memory last_left) public view
    inStage(StageEnum.PRE_VOTING)
    returns(uint[] memory, uint[] memory, uint[3] memory)
  {
    require(0 != MPC_right_markers.length, "Righ markers has not been built yet.");
    require(start_idx < ephemeralPKs.length, "Start idx must be < than the number of participants.");

    uint arrSize = MPC_batch;
    if(ephemeralPKs.length - start_idx < MPC_batch){
      arrSize = ephemeralPKs.length - start_idx;
    }

    uint[3][] memory right_table = new uint[3][](MPC_batch);

    // build the right table using markers created before
    uint skipOffset = 0;
    if(start_idx + MPC_batch > ephemeralPKs.length){ // skipoffset only applies in the last batch of the case where MPC_batch does not divide ephemeralPKs.length
      skipOffset = (MPC_batch - ephemeralPKs.length % MPC_batch);
    }
    right_table[MPC_batch - skipOffset - 1] = MPC_right_markers[MPC_right_markers.length - start_idx / MPC_batch - 1];

    for (uint j = 1 + skipOffset; j < MPC_batch; j++) {
      uint idx = MPC_batch - j;

      (right_table[idx - 1][0],
        right_table[idx - 1][1],
        right_table[idx - 1][2]
      ) = EC.OVN_addMixed(
        right_table[idx],
        ephemeralPKs[start_idx + idx], A, PP
      );
    }

    uint[] memory modInv1 = new uint[](arrSize);
    uint[] memory modInv2 = new uint[](arrSize);
    uint[3] memory res;
    uint[3] memory act_left = last_left;

    // handle the end bound for the main cycle
    uint end_bound = start_idx + MPC_batch;
    if(end_bound > ephemeralPKs.length){
      end_bound = ephemeralPKs.length;
    }

    // build cache of modular inverses for the current batch
    for (uint i = start_idx; i < end_bound; i++) {

      if(0 != i){ // accumulate sum of x_j * G, starting by the first voter
        (act_left[0], act_left[1], act_left[2]) = EC.OVN_addMixed(act_left, ephemeralPKs[i - 1], A, PP);
      }

      modInv1[i % MPC_batch] = EC.invMod(right_table[i % MPC_batch][2], PP); // store modInv for substraction

      // Finally, we do substraction (left - right)
      (res[0], res[1], res[2]) = EC.ecSub_J(act_left[0], act_left[1], act_left[2],
        right_table[i % MPC_batch][0],
        right_table[i % MPC_batch][1],
        right_table[i % MPC_batch][2],
        PP
      );
      modInv2[i % MPC_batch] = EC.invMod(res[2], PP); // store modInv for final affine transformation
    }
    return (modInv1, modInv2, act_left);
  }

/**
  * This is a method called offchain by voters to precompute modular inverses required for onchain vote submission (i.e., affine transformations there)
  */
function modInvCache4SubmitVote(
    uint[] memory proof_B,
    int[] memory proof_r, int[] memory proof_d, uint[2] memory vote
) public view
    returns (uint[] memory)
  {
    uint[3][] memory modInv = new uint[3][](candidates.length);

    uint idxVoter = idxVoters[msg.sender];
    uint[3] memory left;
    uint[6] memory right; // right[3-5] is another tmp variable (since stack deep occurs; allowing only 16 local vars and func params)

    for (uint l = 0; l < candidates.length; l++) {

      ///////////////////////////////////
      // 1) g * {r_l} - X * {d_l} == a_l
      //    where X := g * x_i    (ephemeral PK)
      (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[2 * l], proof_r[2 * l + 1], -proof_d[2 * l], -proof_d[2 * l + 1]],
          [G[0], G[1], 1, ephemeralPKs[idxVoter][0], ephemeralPKs[idxVoter][1], 1],
          A, Beta, PP
      );
      modInv[l][0] = EC.invMod(left[2], PP); // store modInv for 1st affine transformation

      ///////////////////////////////////
      // 2) h * {r_l} + d_l * f_l == b_l + d_l * B_l
      (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[2 * l], proof_r[2 * l + 1], proof_d[2 * l], proof_d[2 * l + 1]],
          [MpcPKs[idxVoter][0], MpcPKs[idxVoter][1], 1, candidatesG[l][0], candidatesG[l][1], 1],
          A, Beta, PP
      );
      (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
          [proof_d[2 * l], proof_d[2 * l + 1], 0, 0],
          [vote[0], vote[1], 1, G[0], G[1], 1],
          A, Beta, PP
      );
      (right[0], right[1], right[2]) = EC.OVN_addMixed(
          [right[0], right[1], right[2]],
          [proof_B[2 * l], proof_B[2 * l + 1]],
          A, PP
      );
      modInv[l][1] = EC.invMod(left[2], PP); // store modInv for 2nd affine transformation
      modInv[l][2] = EC.invMod(right[2], PP); // store modInv for 3rd affine transformation
    }

    // this ugly code is required due to stack deep error that does not allow defining local vars earlier (anyway it is just call-based method)
    uint[] memory ret1 = new uint[](candidates.length * 3);
    for (uint i = 0; i < candidates.length; i++) {
      ret1[i * 3] = modInv[i][0];
      ret1[i * 3 + 1] = modInv[i][1];
      ret1[i * 3 + 2] = modInv[i][2];
    }
    return ret1;
  }

 /**
  * This is a method called offchain by voters to precompute modular inverses required for onchain FT repair vote (i.e., affine transformations there)
  */
  function modInvCache4repairVote(uint[] memory faultyIdx, uint[] memory blindedKeys, uint myIdx,
                                  int[] memory proof_r, int[] memory h_decomp
  ) public view returns (uint[] memory)   
  {                
    uint[2][] memory modInv = new uint[2][](faultyIdx.length);

    for (uint f = 0; f < faultyIdx.length; f++) {                                        
      modInv[f] = FT_modInv4Voter(ephemeralPKs[myIdx], ephemeralPKs[faultyIdx[f]], 
                                  [blindedKeys[2 * f], blindedKeys[2 * f + 1]], 
                                  [proof_r[2 * f], proof_r[2 * f + 1]],
                                  [h_decomp[2 * f], h_decomp[2 * f + 1]]                                  
      );         
    }

    // this ugly code is required due to stack deep error that does not allow defining local vars earlier (anyway it is just a call-based method)
    uint[] memory ret1 = new uint[](faultyIdx.length * 3);
    for (uint i = 0; i < faultyIdx.length; i++) {
      ret1[i * 2] = modInv[i][0];
      ret1[i * 2 + 1] = modInv[i][1];      
    }
    return ret1;
  }
  
  function FT_modInv4Voter(uint[2] storage I, uint[2] storage J, uint[2] memory blindedKey, 
                        int[2] memory proof_r,  int[2] memory h_decomp // decomposed scalars
  ) private view returns(uint[2] memory)
  {
    uint[3] memory left;        
    uint[2] memory ret;

    ///////////////////////////////////
    // 1)   G * r - I * h == m1      // original is G * r == m1 + I * h        
    (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[0], proof_r[1], -h_decomp[0], -h_decomp[1]],
          [G[0], G[1], 1, I[0], I[1], 1],
          A, Beta, PP
    );    
    ret[0] =  EC.invMod(left[2], PP); // store modInv for 1st affine transformation
    
    ///////////////////////////////////
    // 2)  J * r - C * h = m2        // original is J * r = m2 + C * h     (C = blinding key = G * x_i * x_j)    
    (left[0], left[1], left[2]) = FastEcMul.ecSimMul(
          [proof_r[0], proof_r[1], -h_decomp[0], -h_decomp[1]],
          [J[0], J[1], 1, blindedKey[0], blindedKey[1], 1],
          A, Beta, PP
    );    
    ret[1] =  EC.invMod(left[2], PP); // store modInv for 2nd affine transformation    
    return ret;
  }

  /**
   * This is a method called offchain by the authority to precompute modular inverses required for onchain tally submission (i.e., affine transformations there)
   */
  function modInvCache4Tally(int[] memory c_decom) public view returns (uint[2] memory)  
  {    
    // Verify that sum of B_i == f_1 * c_1 + f_2 * c_2 * ... * f_k * c_k
    
    // Compute Sum of B_i (left side)
    uint[3] memory left = [G[0], G[1], 1];
    for (uint i = 0; i < ephemeralPKs.length; i++) {
      if(blindedVotes[i][0] == 0){
        continue;
      }      
      (left[0], left[1], left[2]) = EC.OVN_addMixed(
          [left[0], left[1], left[2]],
          [blindedVotes[i][0], blindedVotes[i][1]],
          A, PP
      );
    }

    // Compute sum of counts * gens (right side)
    uint[3] memory sum = [G[0], G[1], 1];
    uint[3] memory right;
    for (uint l = 0; l < candidatesG.length; l += 2) { // pairwise iteration
      if(l == candidatesG.length - 1){ // in the case of the odd number of candidates, use neutral feature as the second item for multiplication when processing the last candidate
        (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
            [c_decom[2 * l], c_decom[2 * l + 1], 0, 0], // take two consecutive decomposed scalars (consisting of 4 items)
            [candidatesG[l][0], candidatesG[l][1], 1, G[0], G[1], 1], // take 2 consecutive candidate gens
            A, Beta, PP
        );
      }else{ // all other iterations
        (right[0], right[1], right[2]) = FastEcMul.ecSimMul(
            [c_decom[2 * l], c_decom[2 * l + 1], c_decom[2 * l + 2], c_decom[2 * l + 3]], // take two consecutive decomposed scalars (consisting of 4 items)
            [candidatesG[l][0], candidatesG[l][1], 1, candidatesG[l + 1][0], candidatesG[l + 1][1], 1], // take 2 consecutive candidate gens
            A, Beta, PP
        );        
      }      
      
      (sum[0], sum[1], sum[2]) = EC.jacAdd(
          sum[0], sum[1], sum[2],
          right[0], right[1], right[2],
          PP
      );                        
    }
    
    uint[2] memory ret;
    ret[0] =  EC.invMod(left[2], PP); // store modInv for 1st affine transformation    
    ret[1] =  EC.invMod(sum[2], PP); // store modInv for 2nd affine transformation    
    return ret;    
  }

}