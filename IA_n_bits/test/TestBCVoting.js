const BCVoting = artifacts.require("BCVoting");
var Web3 = require('web3');
var W3 = new Web3();

const crypto = require('crypto');
const BN = require('bn.js');

var Voter = require("../library/voter.js");
var Authority = require("../library/authority.js");
var ac = require("../library/config.js"); // Config of unit test authenticator

var Utils = require("../library/utils.js");
var utils = new Utils()

function h(a) { return W3.utils.soliditySha3({v: a, t: "bytes", encoding: 'hex' }); }
function retype(a) { if(typeof a == 'bigint'){return BigInt.asUintN(127, a)}else{ return a}} // make empty when we will have Bigint library in solidity
var STAGE = Object.freeze({"SETUP": 0, "SIGNUP": 1,  "PRE_VOTING" : 2, "VOTING" : 3, "TALLY" : 4});


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

describe.skip("Skipped ", function(){

contract('BCVoting Hardcoded - TEST SUITE 2 [8 voters + 4 candidates]:', function(accounts) {
  var contract;
  var authority = accounts[0];
  var voters = []; // create them during enroll
  var hardcoded_ephSKs = [ // for p in `find . -name "prikey.txt" | sort`; do echo -e "$p: `cat $p`,\n"  ; done | sort
    320384663n,
    12488921n,
    1872252454n,
    1559021474n,
    175825964n,
    958574651n,
    650329980n,
    1418280957n,
  ];
  var hardcoded_ephPKs = [ // for p in `find . -name "pubkey.txt" | sort`; do echo -e "$p: `cat $p`,\n"  ; done | sort
    1425301n,
    2212285n,
    1310618n,
    2073093n,
    1982279n,
    559654n,
    2355422n,
    206625n,
  ];
  var hardcodedMpcKeysForValidation = [
    1033129n,
    512434n,
    1948951n,
    1714652n,
    156621n,
    250338n,
    1924622n,
    2345531n,
  ];
  var hardcodedCntCandidatesCnt = 4;
  var hardcodedCanGenerators = [5, 10, 11, 13]; // serves only for check
  var auth = new Authority(hardcodedCntCandidatesCnt, hardcoded_ephPKs.length, ac.G, ac.MODULUS, ac.DELTA_T, ac.DEPOSIT_AUTHORITY);

  before(async function(){
    contract = await BCVoting.new(auth.candidates,
      auth.cand_generators,
      parseInt(auth.P.toString(), 10),
      parseInt(auth.G.toString(), 10),
      auth.deltaT,
      { from: authority, gas: 6.5 * 1000 * 1000 }
    );
  })


  it("Enroll all voters", async () => {
    console.log(auth.cand_generators)
    assert(JSON.stringify(hardcodedCanGenerators) == JSON.stringify(auth.cand_generators));

    // contract = await BCVoting.deployed();
    var candCnt = await contract.getCntOfCandidates.call()
    assert.equal(candCnt, auth.candidates.length);
    var votersCnt = await contract.getCntOfEligibleVoters.call()
    assert.equal(votersCnt, 0);
    inStage(contract, STAGE.SETUP, curStack());

    var receipt = await contract.enrollVoters(auth.getVoterAddrs(accounts), {from: authority, value: auth.deposit });
    console.log(`\t \\/== Gas used in enrollVoters:`, receipt.receipt.gasUsed);
    voters = createAllVoters(auth, accounts, hardcoded_ephPKs, hardcoded_ephSKs);
    assert.equal(voters.length, auth.cntVoters);

    let psize = await contract.sizeHash.call();
    assert.equal(voters[0].sizeHash, psize);

    votersCnt = await contract.getCntOfEligibleVoters.call()
    assert.equal(votersCnt, auth.cntVoters);
    inStage(contract, STAGE.SIGNUP, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.SIGNUP), false);
  });

  it("Submit ephemeral PKs by all voters", async () => {
    // contract = await BCVoting.deployed();
    inStage(contract, STAGE.SIGNUP, curStack());
    var receipt;

    for (let i = 0; i < voters.length; i++) {
      // console.log("retype(voters[i].Gx) = ", voters[i].Gx.toString());
      receipt = await contract.submitEphemeralPK(voters[i].Gx.toString(), {from: voters[i].address, value: voters[i].deposit });
      console.log(`\t \\/== Gas used in submitEphemeralPK by voter[${i}]:`, receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.SIGNUP, curStack());
      }
    }
    var stageFromContract = await contract.stage.call()
    assert.equal(stageFromContract, STAGE.PRE_VOTING);

    assert(isEventInLogs("SingUpFinished", receipt.receipt.logs))
    inStage(contract, STAGE.PRE_VOTING, curStack()); // the last voter submitted

    receipt.receipt.logs.forEach(e => {
      if(e.event !== undefined && e.event == "SingUpFinished"){
        console.log("\t==> Ephemeral PKs stored in SC are:");
        e.args.submittedEphPKs.forEach( (ephPK, i) => {
          console.log(`\t ephPK[${i}] = `, ephPK.toString());
          assert.equal(ephPK.toString(), hardcoded_ephPKs[i].toString());
        });
      }
    });

    computeMpcKeys(voters);

    // for testing purposes verify correctness of MPC keys by checking \prod{ g^{x_i y_i} } = 1
    let prod = 1n;
    voters.forEach(v => {
      prod = (prod * utils.exp_mod(v.h, v.x, v.P)) % v.P;
    });
    assert.equal(parseInt(prod.toString(), 10), 1);

    ephPKsCnt = await contract.getCntOfEphPKs.call()
    assert.equal(ephPKsCnt, auth.cntVoters);
  });

  it("Compute MPC keys by authority.", async () => {
    // contract = await BCVoting.deployed();
    inStage(contract, STAGE.PRE_VOTING, curStack());

    var receipt = await contract.computeMPCKeys({from: authority});
    console.log(`\t \\/== Gas used in computeMPCKeys:`, receipt.receipt.gasUsed);

    inStage(contract, STAGE.VOTING, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.VOTING), false);
    assert(isEventInLogs("MPCKeysComputedEvent", receipt.receipt.logs))

    // inspect emitted events
    receipt.receipt.logs.forEach(e => {
      if(e.event !== undefined && e.event == "MPCKeysComputedEvent"){
        console.log("\t==> MPC keys computed by SC are:");
        e.args.mpcPKs.forEach( (mpcPK, i) => {
          console.log(`\t mpcPK[${i}] = `, mpcPK.toString());
          assert.equal(mpcPK.toString(), voters[i].h.toString()); // compare MPC keys computed by voters and by SC
          assert.equal(mpcPK.toString(), hardcodedMpcKeysForValidation[i]); // check with hardcoded keys

        });
      }
    });

    mpcPKsCnt = await contract.getCntOfMpcPKs.call()
    assert.equal(mpcPKsCnt, auth.cntVoters);
  });

  it("Submit vote by all voters.", async () => {
    // contract = await BCVoting.deployed();
    inStage(contract, STAGE.VOTING, curStack());

    for (let i = 0; i < voters.length; i++) {
      let args = voters[i].getBlindedVote();
      console.log(`\t voter[${i}] args = `, args);
      var receipt = await contract.submitVote(...args, {from: voters[i].address});
      console.log(`\t \\/== Gas used in submitVote by voter[${i}]:`, receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.VOTING, curStack());
      }

      // inspect emitted events
      // assert(isEventInLogs("FirstConditionEvent", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "FirstConditionEvent"){
      //     console.log("\t==>", e.args);
      //   }
      // });

    }
    inStage(contract, STAGE.TALLY, curStack()); // the last voter submitted a vote
    assert(isEventInLogs("VotingFinished", receipt.receipt.logs))
    receipt.receipt.logs.forEach(e => {
      if(e.event !== undefined && e.event == "VotingFinished"){
        console.log("\t==>", e.args.submittedVotes);
        e.args.submittedVotes.forEach( bvote => {
          auth._blindedVotes.push(BigInt(bvote));
        });
      }
    });

    votesCnt = await contract.getCntOfBlinedVotes.call()
    assert.equal(votesCnt, auth.cntVoters);
  });

  it("Compute tally by authority.", async () => {
    // contract = await BCVoting.deployed();
    inStage(contract, STAGE.TALLY, curStack());

    let tally = [];
    for (let i = 0; i < auth.candidates.length; i++) {
      tally.push(0n);
    }
    console.log("tally = ", tally);
    for (let i = 0; i < voters.length; i++) {
      tally[voters[i].vote] += 1n;
    }

    console.log("Vote counts brutforced by authority are: ", tally)
    assert.equal(auth.prodOfBVotes(), auth.expCandGens(tally));

    var receipt = await contract.computeTally(utils.BIarrayToHex(tally, utils.ByteSizeFittedToArgument(BigInt(voters.length))), {from: authority});
    console.log(`\t \\/== Gas used in computeTally by authority:`, receipt.receipt.gasUsed);

    assert(isEventInLogs("TallyCompleted", receipt.receipt.logs));
    // receipt.receipt.logs.forEach(e => {
    //   if(e.event !== undefined && e.event == "TallyCompleted"){
    //     console.log("\t==>", e.args.tally);
    //   }
    // });
  });
});

}) //


contract('BCVoting Arbitrary keys/voters/candidates - TEST SUITE 3:', function(accounts) {
  var contract;
  var authority = accounts[0];
  var voters = []; // create them during enroll
  var auth = new Authority(ac.CANDIDATES_CNT,  ac.VOTERS_CNT, ac.G, ac.MODULUS, ac.DELTA_T, ac.DEPOSIT_AUTHORITY);

  it("Check shaX() function", async () => {
    contract = await BCVoting.deployed();

    for (let i = 64; i < 80; i++) {
      // console.log(`[size = ${i}]`)
      var arg = crypto.randomBytes(i);
      var hashSC = await contract.shaX.call("0x" + arg.toString('hex'), auth.sizeP + 4);
      assert.equal(hashSC, utils.shaX("0x" + arg.toString('hex'), auth.sizeP + 4));
    }

  });

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

    let psize = await contract.sizeHash.call();
    assert.equal(voters[0].sizeHash, psize);

    votersCnt = await contract.getCntOfEligibleVoters.call()
    assert.equal(votersCnt, auth.cntVoters);
    inStage(contract, STAGE.SIGNUP, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.SIGNUP), false);
  });

  it("Submit ephemeral PKs by all voters", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.SIGNUP, curStack());
    var receipt;

    let gasOfSubmitEph = [];
    for (let i = 0; i < voters.length; i++) {
      console.log(`ephPK[${i}] = `, utils.BI2BNsolidity(voters[i].Gx, true));
      receipt = await contract.submitEphemeralPK(...utils.BI2BNsolidity(voters[i].Gx, true), {from: voters[i].address, value: voters[i].deposit });
      console.log(`\t \\/== Gas used in submitEphemeralPK by voter[${i}]:`, receipt.receipt.gasUsed);
      gasOfSubmitEph.push(receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.SIGNUP, curStack());
      }

      let ephPKBytes  = await contract.getEphPK.call(i);
      assert.equal(ephPKBytes, utils.BI2BNsolidity(voters[i].Gx)[0]);
    }
    console.log(`\t \\/== AVERAGE gas used in submit eph key:`, arr.mean(gasOfSubmitEph));
    console.log(`\t \\/== STDDEV of gas used in submit eph key:`, arr.stddev(gasOfSubmitEph));

    var stageFromContract = await contract.stage.call()
    assert.equal(stageFromContract, STAGE.PRE_VOTING);

    assert(isEventInLogs("SingUpFinished", receipt.receipt.logs))
    inStage(contract, STAGE.PRE_VOTING, curStack()); // the last voter submitted

    // console.log("\t==> Ephemeral PKs stored in SC are:", receipt.receipt.logs[0].args);

    // receipt.receipt.logs.forEach(e => {
    //   if(e.event !== undefined && e.event == "SingUpFinished"){
    //     console.log("\t==> Ephemeral PKs stored in SC are:");
    //     // console.log("\t==> Ephemeral PKs stored in SC are:", e);
    //     e.args.submittedEphPKs.forEach( (ephPK, i) => {
    //       console.log(`\t ephPK[${i}] = `, ephPK);
    //       // assert.equal(ephPK.val, utils.BI2BNsolidity(voters[i].Gx)[0]);
    //     });
    //   }
    // });

    computeMpcKeys(voters);


    // for testing purposes verify correctness of MPC keys by checking \prod{ g^{x_i y_i} } = 1
    let prod = 1n;
    voters.forEach(v => {
      prod = (prod * utils.exp_mod(v.h, v.x, v.P)) % v.P;
    });
    assert.equal(parseInt(prod.toString(), 10), 1);

    ephPKsCnt = await contract.getCntOfEphPKs.call()
    assert.equal(ephPKsCnt, auth.cntVoters);
  });


  it("Compute MPC keys by authority.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.PRE_VOTING, curStack());

    var receipt = await contract.computeMPCKeys(...auth.getCacheOfModInvMPC(voters), {from: authority});
    console.log(`\t \\/== Gas used in computeMPCKeys:`, receipt.receipt.gasUsed);

    inStage(contract, STAGE.VOTING, curStack());
    assert.equal(await expiredTimeout(contract, STAGE.VOTING), false);
    assert(isEventInLogs("MPCKeysComputedEvent", receipt.receipt.logs))


    // console.log("\t==> MPC keys computed by SC are:", receipt.receipt.logs[0].args);

    for (let i = 0; i < voters.length; i++) {
      let mpcPK = await contract.getMPCPK.call(i);
      assert.equal(mpcPK.toString(), utils.BI2BNsolidity(voters[i].h.toString(16))[0]); // compare MPC keys computed by voters and by SC
    }

    mpcPKsCnt = await contract.getCntOfMpcPKs.call()
    assert.equal(mpcPKsCnt, auth.cntVoters);

    throw new Error("....");

  });

  it("Submit vote by all voters.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.VOTING, curStack());

    let gasOfVote = [];
    for (let i = 0; i < voters.length; i++) {
      let args = voters[i].getBlindedVote();
      console.log(`\t voter[${i}] args = `, args);
      var receipt = await contract.submitVote(...args, {from: voters[i].address, gas: 250111555});
      console.log(`\t \\/== Gas used in submitVote by voter[${i}]:`, receipt.receipt.gasUsed);

      // assert(isEventInLogs("ArraysCompared", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "ArraysCompared"){
      //     console.log("\t ArraysCompared ==>", e.args);
      //   }
      // });

      // assert(isEventInLogs("HashInputEvent", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "HashInputEvent"){
      //     console.log("\t HashInputEvent ==>", e.args);
      //   }
      // });

      // assert(isEventInLogs("FirstConditionEvent", receipt.receipt.logs))
      // receipt.receipt.logs.forEach(e => {
      //   if(e.event !== undefined && e.event == "FirstConditionEvent"){
      //     console.log("\t FirstConditionEvent ==>", e.args);
      //   }
      // });

      gasOfVote.push(receipt.receipt.gasUsed);
      if (i != voters.length - 1){
        inStage(contract, STAGE.VOTING, curStack());
      }
    }
    console.log(`\t \\/== AVERAGE gas used in submit vote: ${arr.mean(gasOfVote)} \t (+-${arr.mean(gasOfVote)})`);
    console.log(`\t \\/== STDDEV of gas used in submit vote:`, arr.stddev(gasOfVote));


    inStage(contract, STAGE.TALLY, curStack()); // the last voter submitted a vote
    assert(isEventInLogs("VotingFinished", receipt.receipt.logs))
    for (let i = 0; i < voters.length; i++) {
      let bvote = await contract.getBlindedVote.call(i);
      auth._blindedVotes.push(BigInt(bvote));
    }

    votesCnt = await contract.getCntOfBlinedVotes.call()
    assert.equal(votesCnt, auth.cntVoters);
  });

  it("Compute tally by authority.", async () => {
    contract = await BCVoting.deployed();
    inStage(contract, STAGE.TALLY, curStack());

    let tally = [];
    for (let i = 0; i < auth.candidates.length; i++) {
      tally.push(0n);
    }
    for (let i = 0; i < voters.length; i++) {
      tally[voters[i].vote] += 1n;
    }
    console.log("tally = ", tally);

    // console.log("Vote counts brutforced by authority are: ", tally)
    assert.equal(auth.prodOfBVotes(), auth.expCandGens(tally));

    var receipt = await contract.computeTally(utils.BIarrayToHex(tally, utils.ByteSizeFittedToArgument(BigInt(voters.length))), {from: authority});
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

function createAllVoters(auth, accounts, hardcoded_ephPKs = false, hardcoded_ephSKs = false){
  // false has speacial meaning indicating that voters will generate keys on their own
  voters = [];
  for (let i = 1; i < auth.cntVoters + 1; i++) {
    let ephPK = (Array.isArray(hardcoded_ephPKs))? hardcoded_ephPKs[i - 1]: false;
    let ephSK = (Array.isArray(hardcoded_ephSKs))? hardcoded_ephSKs[i - 1]: false;
    var voter = new Voter(i - 1, auth.G, auth.cand_generators, auth.candidates, auth.P, accounts[i], ac.VOTER_DEPOSIT, ephPK, ephSK);
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

function isEventInLogs(event, logs){
  for (let i = 0; i < logs.length; i++) {
    if(logs[i].event !== undefined && logs[i].event == event){
      return true;
    }
  }
  return false;
};

const increaseTime = addSeconds => {
  web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [addSeconds], id: 0
  })
}

const decreaseTime = addSeconds => {
  web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_decreaseTime",
      params: [addSeconds], id: 0
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
    return Math.round(Math.sqrt(arr.variance(array)));
  },

  mean: function(array) {
    return Math.round(arr.sum(array) / array.length);
  },

  sum: function(array) {
    var num = 0;
    for (var i = 0, l = array.length; i < l; i++) num += array[i];
    return Math.round(num);
  },
};
