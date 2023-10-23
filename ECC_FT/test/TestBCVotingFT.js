const BCVoting = artifacts.require("BCVoting");
const BCVotingFactory = artifacts.require("BCVotingFactory");
const FastEC = artifacts.require("FastEcMul");
var Web3 = require('web3');
var W3 = new Web3();

const ec = require('simple-js-ec-math');
var Voter = require("../library/voter.js");
var Authority = require("../library/authority.js");
var ac = require("../library/config.js"); // Config of unit test authenticator
var auth = new Authority(ac.CANDIDATES_CNT, ac.VOTERS_CNT, ac.Gx, ac.Gy, ac.NN, ac.PP , ac.DELTA_T, ac.DEPOSIT_AUTHORITY, ac.FAULTY_VOTERS);

var Utils = require("../library/utils.js");
// const { assert } = require('console');
var _ = require('underscore');
var utils = new Utils()

function h(a) { return W3.utils.soliditySha3({v: a, t: "bytes", encoding: 'hex' }); }
function retype(a) { if(typeof a == 'bigint'){return BigInt.asUintN(127, a)}else{ return a}} // make empty when we will have Bigint library in solidity
var STAGE = Object.freeze({"SETUP": 0, "SIGNUP": 1,  "PRE_VOTING" : 2, "VOTING" : 3, "FT_RESOLUTION" : 4, "TALLY" : 5});



// BCVotingFactory

// describe.skip("Skipped ", function(){

  contract('BCVoting - TEST SUITE 0 [Check contract factory]', function(accounts) {
    it("Create BCVoting contract by factory", async () => {
      contractFactory = await BCVotingFactory.deployed();
      var receipt = await contractFactory.createBCVoting(
        auth.candidates, auth.cand_generators_1D_array,
        auth.deltaT, ac.MPC_BATCH_SIZE,
        { from: accounts[0], gas: 16.5 * 1000 * 1000 }
      );
      console.log(`\t \\/== Gas used in createBCVoting():`, receipt.receipt.gasUsed);
      // throw new Error("....");
    });

  });

  // }) //



// describe.skip("Skipped ", function(){

contract('BCVoting - TEST SUITE 1 [Initial checks]', function(accounts) {

  it("Zero Ballance", function(){
    return BCVoting.deployed()
    .then(function(instance) {
      // console.log(instance.contract._address);
      return web3.eth.getBalance(instance.contract._address);
    })
    .then(function(result) {
      assert.equal(0, result);
    });
  });

  it("Authority is account[0]", function(){
    return BCVoting.deployed()
    .then(function(instance) {
      authority = instance.contract.methods.authority().call();
      return authority;
    })
    .then(function(authority) {
      // console.log(authority)
      assert.equal(accounts[0], authority);
    });
  });
});

// }) //

contract('BCVoting Arbitrary keys/voters/candidates - TEST SUITE 3:', function(accounts) {
  var contract;
  var authority = accounts[0];
  var voters = []; // create them during enroll
  var precompGas = null;
  var invModArrs_MPC = null;

  it("Enroll all voters", async () => {
    contract = await BCVoting.deployed();
    var candCnt = await contract.getCntOfCandidates.call()
    assert.equal(candCnt, auth.candidates.length);
    var votersCnt = await contract.getCntOfEligibleVoters.call()
    assert.equal(votersCnt, 0);
    inStage(contract, STAGE.SETUP, curStack());

    var receipt = await contract.enrollVoters(auth.getVoterAddrs(accounts), {from: authority, value: auth.deposit });
    console.log(`\t \\/== Gas used in enrollVoters:`, receipt.receipt.gasUsed);
    voters = createAllVoters(auth, accounts);
    assert.equal(voters.length, auth.cntVoters);

    votersCnt = await contract.getCntOfEligibleVoters.call()
    assert.equal(votersCnt, auth.cntVoters);
    inStage(contract, STAGE.SIGNUP, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.SIGNUP), false);

  }).timeout(0);

  it("Submit ephemeral PKs by all voters", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.SIGNUP, curStack());
    var receipt;

    let gasOfSubmitEph = [];
    for (let i = 0; i < voters.length; i++) {

      // console.log("Submit EphemeralPK by voters[${i}]: ", voters[i].Gx_as_pair)
      receipt = await contract.submitEphemeralPK(voters[i].Gx_as_pair, {from: voters[i].address, value: voters[i].deposit });
      console.log(`\t \\/== Gas used in submitEphemeralPK by voter[${i}]:`, receipt.receipt.gasUsed);
      gasOfSubmitEph.push(receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.SIGNUP, curStack());
      }

    }
    console.log(`\t \\/== AVERAGE gas used in submit eph key:`, arr.mean(gasOfSubmitEph));
    console.log(`\t \\/== STDDEV of gas used in submit eph key:`, arr.stddev(gasOfSubmitEph));

    var stageFromContract = await contract.stage.call()
    assert.equal(stageFromContract, STAGE.PRE_VOTING);

    assert(isEventInLogs("SingUpFinished", receipt.receipt.logs))
    inStage(contract, STAGE.PRE_VOTING, curStack()); // the last voter submitted

    // receipt.receipt.logs.forEach(e => {
    //   if(e.event !== undefined && e.event == "SingUpFinished"){
    //     console.log("\t==> Ephemeral PKs stored in SC are:");
    //     e.args.submittedEphPKs.forEach( (ephPK, i) => {
    //       console.log(`\t ephPK[${i}] = `, ephPK.toString());
    //       assert.equal(ephPK.toString(), voters[i].Gx.toString());
    //     });
    //   }
    // });

    // computeMpcKeys(voters);
    computeMpcKeysFast(voters); // the computation is centralized, only for testing purposes

    // for testing purposes verify correctness of MPC keys by checking \sum{ g x_i y_i} } = 1
    let sum = auth.G;
    voters.forEach(v => {
      sum = auth.curve.add(
        sum,
        auth.curve.multiply(v.h, v.x)
      );
    });
    // console.log("verify correctness of MPC keys: sum = ", sum);
    assert.equal(sum.toString(), auth.G.toString());

    var ephPKsCnt = await contract.getCntOfEphPKs.call()
    assert.equal(ephPKsCnt, auth.cntVoters);
  });


  it("Compute MPC keys by authority (precomputation of markers).", async () => {
    contract = await BCVoting.deployed();

     // build right markers in storage first
     var receipt = await contract.buildRightMarkers4MPC({from: authority});
     console.log(`\t \\/== Gas used in buildRightMarkers4MPC:`, receipt.receipt.gasUsed);
     precompGas = receipt.receipt.gasUsed;
     var markersCnt = await contract.getCntOfMarkersMPC.call()
     assert.equal(markersCnt, Math.ceil(ac.VOTERS_CNT / ac.MPC_BATCH_SIZE));

  }).timeout(0);

  it("Compute MPC keys by authority.", async () => {
    contract = await BCVoting.deployed();

    let gasOfMPC = [];
    var act_left = [utils.toPaddedHex(auth._G.x, 32), utils.toPaddedHex(auth._G.y, 32), 1];

    for (let j = 0; j < ac.VOTERS_CNT / ac.MPC_BATCH_SIZE; j++) {
      inStage(contract, STAGE.PRE_VOTING, curStack());

      // var receipt = await contract.modInvCache4MPCBatched2(j * ac.MPC_BATCH_SIZE, act_left, {from: authority});
      // console.log(`\t \\/== Gas used in modInvCache4MPCBatched2:`, receipt.receipt.gasUsed);

      // precomputation of mudular inverses off-chain
      invModArrs_MPC = await contract.modInvCache4MPCBatched.call(j * ac.MPC_BATCH_SIZE, act_left);
      console.log(`\t\t invModArrs_MPC[${j + 1}/${ac.VOTERS_CNT / ac.MPC_BATCH_SIZE}] was built.`);
      // console.log("\t\t invModArrs_MPC = ", invModArrs_MPC);
      act_left = invModArrs_MPC[2]; // store value of actual left accumulated value and reuse it in the next call

      var receipt = await contract.computeMPCKeys(
          invModArrs_MPC[1],
          invModArrs_MPC[0],
          {from: authority}
      );
      console.log(`\t \\/== Gas used in computeMPCKeys[${j}]:`, receipt.receipt.gasUsed);
      assert(isEventInLogs("MPCKeysComputedEvent", receipt.receipt.logs))
      gasOfMPC.push(receipt.receipt.gasUsed);

      // // inspect emitted events - and check MPC from SC with ones from voters (works fine)
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "MPCKeysComputedEvent"){
      //     console.log("\t==> MPC keys computed by SC are:");
      //     var mpcKeys1D = e.args.mpcKeys1D;
      //     assert.equal(mpcKeys1D.length % 2, 0);
      //     for (let i = 0; i < (mpcKeys1D.length / 2); i++) {
      //       if(i >= (j * ac.MPC_BATCH_SIZE)){
      //         var mpcSC = [BigInt(mpcKeys1D[i*2]), BigInt(mpcKeys1D[i*2 + 1])];
      //         var mpcVoter = [BigInt(voters[i].h.x), BigInt(voters[i].h.y)];
      //         // console.log(`\t mpcPK[${i}].SC = `, mpcSC);
      //         // console.log(`\t mpcPK[${i}].voter = `, mpcVoter);
      //         assert.equal(mpcSC.toString(), mpcVoter.toString()); // compare MPC keys computed by voters and by SC
      //       }
      //     }
      //   }
      // });

    }
    console.log(`\t \\/== AVERAGE gas used in compute MPC key:`, arr.mean(gasOfMPC));
    console.log(`\t \\/== STDDEV of gas used in compute MPC key:`, arr.stddev(gasOfMPC));
    console.log(`\t \\/== SUM of gas used in compute MPC key: ${arr.sum(gasOfMPC)} (+-${arr.stddev(gasOfMPC)}) + precomputation: ${precompGas}`);

    inStage(contract, STAGE.VOTING, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.VOTING), false);

    mpcPKsCnt = await contract.getCntOfMpcPKs.call()
    assert.equal(mpcPKsCnt, auth.cntVoters);

  }).timeout(0);

  it("Submit vote by all minus faulty voters.", async () => {
    contract = await BCVoting.deployed();
    contractFastEC = await FastEC.deployed();
    inStage(contract, STAGE.VOTING, curStack());  
    console.log(`\t \\/== Not voted IDXes are:`, auth._nonVotedIDXes);

    let gasOfVote = [];
    for (let i = 0; i < voters.length; i++) {
      if(_.contains(auth._nonVotedIDXes, i)){ // skip non-voting participants
          continue;
      }
      
      let args = voters[i].getBlindedVote();
      console.log(`\t voter[${i}] args = `, args);

      // decompose scalars of proof_r to two parts
      var decomp = [];
      for (let j = 0; j < ac.CANDIDATES_CNT; j++) {
        var tmpItems = await contractFastEC.decomposeScalar.call(args[3][j], ac.NN, ac.LAMBDA);
        decomp.push(BigInt(tmpItems[0]));
        decomp.push(BigInt(tmpItems[1]));
      }

      args[3] = utils.BIarrayToHexUnaligned(decomp); // update proof_r in arguments of SC (should be 2x longer)

      // decompose scalars of proof_d to two parts, while preserve the orig one
      var decomp = [];
      for (let j = 0; j < ac.CANDIDATES_CNT; j++) {
        var tmpItems = await contractFastEC.decomposeScalar.call(args[0][j], ac.NN, ac.LAMBDA);
        decomp.push(BigInt(tmpItems[0]));
        decomp.push(BigInt(tmpItems[1]));
      }
      args[4] = utils.BIarrayToHexUnaligned(decomp); // update proof_d in arguments of SC (should be 2x longer)
      console.log(`\t voter[${i}] modified args (with scalar decomp) = `, args);

      // precomputation of mudular inverses off-chain
      var tmpPars = args.slice(1)
      var invModArrs = await contract.modInvCache4SubmitVote.call(...(tmpPars.slice(1)), {from: voters[i].address});
      // console.log("invModArrs_submitVote = ", invModArrs)authority

      var receipt = await contract.submitVote(...tmpPars, invModArrs, {from: voters[i].address, gas: 50111555});
      console.log(`\t \\/== Gas used in submitVote by voter[${i}]:`, receipt.receipt.gasUsed);
      voters[i]._voted = true;

      // assert(isEventInLogs("ArraysCompared", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "ArraysCompared"){
      //     console.log("\t ArraysCompared ==>", e.args);
      //   }
      // });

      // assert(isEventInLogs("FirstConditionEvent", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "FirstConditionEvent"){
      //     console.log(`\t FirstConditionEvent ==> \n\t
      //     L: ${utils.BIarrayToHexUnaligned(e.args.left)}, \n\t R: ${utils.BIarrayToHexUnaligned(e.args.right)},`);
      //   }
      // });
      // throw new Error("....");

      gasOfVote.push(receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.VOTING, curStack());
      }
    }
    console.log(`\t \\/== AVERAGE gas used in submit vote: ${arr.mean(gasOfVote)} (+-${arr.stddev(gasOfVote)})`,);


    // throw new Error("....");

    inStage(contract, STAGE.VOTING, curStack()); // the last voter submitted a vote
    // assert(isEventInLogs("VotingFinished", receipt.receipt.logs))
    // receipt.receipt.logs.forEach(e => {
    //   if(e.event !== undefined && e.event == "VotingFinished"){
    //     // console.log("\t==>", e.args.submittedVotes);
    //     for (let i = 0; i < e.args.submittedVotePairs.length / 2; i++) {
    //       var arr = e.args.submittedVotePairs;
    //       auth._blindedVotes.push(
    //         new ec.ModPoint(BigInt(arr[2 * i]), BigInt(arr[2 * i + 1]))
    //       );
    //     }
    //   }
    // });
    for (let i = 0; i < auth._cntVoters; i++) {        
      if(_.contains(auth._nonVotedIDXes, i)){ // skip non-voting participants
          continue;
      }        
      var bvote = await contract.getBlinedVote.call(i)    
        auth._blindedVotes.push(
          new ec.ModPoint(BigInt(bvote[0]), BigInt(bvote[1]))
        );
    }

    votesCnt = await contract.getCntOfBlinedVotes.call()
    assert.equal(votesCnt, auth.cntVoters - auth.cntFaultyVoters);    
  }).timeout(0);


  it("Shift stage to FT resolution.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.VOTING, curStack());

    increaseTime(ac.DELTA_T + 10);

    var receipt = await contract.changeStageToFT_Resolution({from: authority});
    console.log(`\t \\/== Gas used in changeStageToFT_Resolution():`, receipt.receipt.gasUsed);
    assert(isEventInLogs("VotingExpiredWithMissingVotes", receipt.receipt.logs));
    
    // save non-voting indices    
    let nonVotedIDXes_fromSC = [];
    receipt.receipt.logs.forEach(e => {
      if(e.event !== undefined && e.event == "VotingExpiredWithMissingVotes"){
        // console.log("\t==>", e.args.submittedVotes);
        for (let i = 0; i < e.args.notVotedIdxs.length; i++) {          
          nonVotedIDXes_fromSC.push(Number(e.args.notVotedIdxs[i]));          
        }
      }
    });
    assert(_.difference(auth._nonVotedIDXes,  nonVotedIDXes_fromSC).length == 0);
    inStage(contract, STAGE.FT_RESOLUTION, curStack());    
  });

  it("Do FT resolution for non-voting participants.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.FT_RESOLUTION, curStack());
     
    let gasOfRepairs = [];

    for (let i = 0; i < voters.length; i++) {
      if(false == voters[i]._voted){ // filter out non-voting voters
        continue;
      }
         
      // build all blinding keys required for FT recovery and their proofs
      var blindkeys = [];
      for (let k = 0; k < ac.FAULTY_VOTERS; k++) {
        const f = auth._nonVotedIDXes[k]; // index of non-voting participant                            
        blindkeys.push(...voters[i].computeBlindKeyForVoter(voters[f].Gx));        
        // console.log(`JS: blinded key of voter[${f}] and voter[${i}] = `,  blindkeys[2 * k], blindkeys[2 * k + 1]);                          
      }
      let args = voters[i].computeZKproofs4FT(auth._nonVotedIDXes, voters);
      console.log(`Proof of blinding key for voter[${i}] = `, args);            

      // decompose scalars of proof_r to two parts
      var decomp = [];
      for (let j = 0; j < ac.FAULTY_VOTERS; j++) {
        var tmpItems = await contractFastEC.decomposeScalar.call(args[0][j], ac.NN, ac.LAMBDA);
        decomp.push(BigInt(tmpItems[0]));
        decomp.push(BigInt(tmpItems[1]));
      }
      args[0] = utils.BIarrayToHexUnaligned(decomp); // update proof_r in arguments of SC (should be 2x longer)

      // decompose scalars of hashes to two parts
      var decomp = [];
      for (let j = 0; j < ac.FAULTY_VOTERS; j++) {
        var tmpItems = await contractFastEC.decomposeScalar.call(args[1][j], ac.NN, ac.LAMBDA);
        decomp.push(BigInt(tmpItems[0]));
        decomp.push(BigInt(tmpItems[1]));
      }
      args[1] = utils.BIarrayToHexUnaligned(decomp); // update hashes in arguments of SC (should be 2x longer)
      console.log(`\t voter[${i}] modified args (with scalar decomp) = `, args);

      // precomputation of mudular inverses off-chain      
      var invModArrs = await contract.modInvCache4repairVote.call(auth._nonVotedIDXes, blindkeys, i, ...(args.slice(0, 2)), {from: voters[i].address});
      // console.log("invModArrs_FT_repairVote = ", invModArrs);

      var receipt = await contract.FT_repairBlindedVote(invModArrs, ...args, blindkeys, auth._nonVotedIDXes, i, {from: voters[i].address});
      console.log(`\t \\/== Gas used in FT_repairBlindedVote[${i}]:`, receipt.receipt.gasUsed);
      gasOfRepairs.push(receipt.receipt.gasUsed);

      assert(isEventInLogs("RepairedBVoteEvent", receipt.receipt.logs))
      receipt.receipt.logs.forEach(e => {
        if(e.event !== undefined && e.event == "RepairedBVoteEvent"){
          console.log("\t==> repaired bvote from SC = ", utils.BIarrayToHexUnaligned(e.args.blindedVote));            
        }
        if(e.event !== undefined && e.event == "HashComputedEvent"){
          console.log("\t==> hash computed in SC = ", utils.BIarrayToHexUnaligned([e.args.h]));            
        }
        if(e.event !== undefined && e.event == "ArraysCompared"){
          console.log("\t==> 1st cond left in SC = ", e.args.a1);            
          console.log("\t==> 1st cond right in SC = ", e.args.a2);            
        }
      }); 
      
      var repairedBlindedVote = voters[i].repairBlindedVote_FT(auth._nonVotedIDXes, voters);
      console.log(`Repaired blinded vote of voter[${i}] = `, utils.ECPointsArrayToHex([repairedBlindedVote], this._sizeP));
    }
    console.log(`\t \\/== AVERAGE gas used in repair vote: ${arr.mean(gasOfRepairs)} (+-${arr.stddev(gasOfRepairs)})`,);   
    
    inStage(contract, STAGE.TALLY, curStack());    
  }).timeout(0);

  it("Compute tally by authority.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.TALLY, curStack());

    let tally = [];
    for (let i = 0; i < auth.candidates.length; i++) {
      tally.push(BigInt(0));
    }
    for (let i = 0; i < voters.length; i++) {
      if(_.contains(auth._nonVotedIDXes, i)){ // skip non-voting
          continue;
      }
      tally[voters[i].vote] += 1n;
    }

    console.log("Vote counts brute-forced by authority are: ", tally)
    assert.equal(auth.sumOfBVotes_FT(auth._nonVotedIDXes, voters).toString(), auth.expCandGens(tally).toString());

    var receipt = await contract.computeTally(
      utils.BIarrayToHex(tally, utils.ByteSizeFittedToArgument(
                                        BigInt(voters.length - auth._nonVotedIDXes.length)
                                )
                        ), 
      {from: authority}
    );
    console.log(`\t \\/== Gas used in computeTally by authority:`, receipt.receipt.gasUsed);

    assert(isEventInLogs("TallyCompleted", receipt.receipt.logs));
  });


});


// }) //

///// AUX Functions /////

const inStage = async(bcContract, expected_stage, stack) => {
  try {
    var stageFromContract = await bcContract.stage.call()
    assert.equal(stageFromContract, expected_stage);
  }
  catch(err) {
    console.log("inStage Error: ", stack);
    throw err
  }


}

const expiredTimeout = async(bcContract, stage) => {
  var timeOutFromCon;

  switch (stage) {
    case STAGE.SIGNUP:
      timeOutFromCon = await bcContract.timeout_SignUp.call()
      break;

    case STAGE.PRE_VOTING:
      timeOutFromCon = await bcContract.timeout_PreVoting.call()
      break;

    case STAGE.VOTING:
      timeOutFromCon = await bcContract.timeout_Voting.call()
      break;

    default:
        throw new Error("Invalid timeout requested: " + stage);
  }
  // console.log("timeOutFromCon = ", timeOutFromCon);
  var isExpired = await bcContract.expiredTimeout.call(timeOutFromCon);
  // console.log("isExpired = ", isExpired);
  return isExpired;
}

function createAllVoters(auth, accounts){
  // false has speacial meaning indicating that voters will generate keys on their own
  voters = [];
  for (let i = 1; i < auth.cntVoters + 1; i++) {
    var voter = new Voter(i - 1, auth.G, auth.cand_generators, auth.candidates, auth.curve, accounts[i], ac.VOTER_DEPOSIT);
    voters.push(voter);
  }
  return voters;
}

function curStack(){
  return new Error().stack
}

function computeMpcKeys(voters){

  let allEphPKs = [];
  voters.forEach(v => {
    allEphPKs.push(v.Gx);
  });

  voters.forEach(v => {
    v.computeMpcPK(allEphPKs);
  });
}

function computeMpcKeysFast(voters){

  let allEphPKs = [];
  voters.forEach(v => {
    allEphPKs.push(v.Gx);
  });

  var curve = voters[0].curve;

  var right_table = new Array(voters.length);
  right_table[voters.length - 1] = voters[0].G;
  for (let j = 1; j < voters.length; j++) {
    right_table[voters.length - j - 1] = curve.add(right_table[voters.length - j], allEphPKs[allEphPKs.length - j]);
  }

  var sum_1 = voters[0].G;
  for (let j = 0; j < voters.length; j++) {
    if(j != 0 ){
      sum_1 = curve.add(sum_1, allEphPKs[j - 1]);
    }
    voters[j]._h = curve.subtract(sum_1, right_table[j]);
    console.log(`\t The voters[${j}] computed his MPC PK  (i.e. h) =  ${voters[j]._h}`);
  }
}

function isEventInLogs(event, logs){
  for (let i = 0; i < logs.length; i++) {
    if(logs[i].event !== undefined && logs[i].event == event){
      return true;
    }
  }
  return false;
};

const increaseTime = time => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [time],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

const decreaseTime = time => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_decreaseTime',
      params: [time],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

var arr = {
  variance: function(array) {
    var mean = arr.mean(array);
    return arr.mean(array.map(function(num) {
      return Math.pow(num - mean, 2);
    }));
  },

  stddev: function(array) {
    return Math.sqrt(arr.variance(array));
  },

  mean: function(array) {
    return arr.sum(array) / array.length;
  },

  sum: function(array) {
    var num = 0;
    for (var i = 0, l = array.length; i < l; i++) num += array[i];
    return num;
  },
};
