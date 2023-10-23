let Utils = require("./utils.js");
var _ = require('underscore');
var utils = new Utils();
const ec = require('simple-js-ec-math');

function h(a) { return W3.utils.soliditySha3({v: a, t: "bytes", encoding: 'hex' }); }


var Authority = function (_cnt_candidates, _cnt_voters, _Gx, _Gy, _NN, _PP, _DELTA_T, _DEPOSIT_AUTHORITY, _FAULTY_VOTERS) {
    this._G = new ec.ModPoint(BigInt(_Gx), BigInt(_Gy));
    this._NN = BigInt(_NN); // Modulus for private keys
    this._PP = BigInt(_PP); // Modulus for public keys
    this._curve = new ec.Curve(0n, 7n, this._NN , this._PP, this._G); // create Sec256k1 curve
    this._deltaT = _DELTA_T;
    this._deposit = _DEPOSIT_AUTHORITY;    
    this._faulty_voters_cnt = _FAULTY_VOTERS;
    this._cand_generators = this.initCandGenerators(_cnt_candidates);
    // this._cand_generatorsBI = utils.cloneArray(this._cand_generators, true);
    this._cntVoters = _cnt_voters;
    this._candidates = this.getCandNames();
    this._blindedVotes = []; // here will be stored blinded votes submitted by voters
    this._sizeP = 32;
    this._nonVotedIDXes = utils.sort(_.sample(_.range(_cnt_voters), _FAULTY_VOTERS)); // array of non-voting participants
    // console.log(`\t Authority: not voted IDXes are:`, this._nonVotedIDXes);


    // // minus_d = nn - d mod nn
    // var d = 5n;
    // var minus_d = (this._NN - d) % this._NN;
    // console.log("minus_d = ", minus_d);
    // d = (this._NN - minus_d) % this._NN;
    // console.log("new d = ", d);
    // throw new Error("...");

    //  - (X * d) ==  -d * X
    // var d = 5n;
    // var a = this._curve.multiply(this._G, d);
    // a = this._curve.multiply(a, -1n);
    // console.log("a = ", a);
    // var b = this._curve.multiply(this._G, -d);
    // console.log("b = ", b);
    // throw new Error("...");

    // console.log("G = ", this._G);
    // var a = this._curve.multiply(this._G, 0n); // it is G
    // console.log("a = ", a);
    // throw new Error("...");

    // console.log("G = ", this._G);
    // var a = this._curve.add(this._G, this._G); //
    // console.log("a = ", a);
    // throw new Error("...");

    // console.log("G = ", this._G);
    // var a = this._curve.subtract(this._curve.multiply(this._G, 2n), this._G); // it is undefined
    // console.log("a = ", a);


    // console.log("a = ", this._curve.multiply(this._G, -5n));
    // console.log("b = ", this._curve.multiply(this._G, this._NN + 5n));
    // throw Error("Not Implemented")

    if (this._cntVoters < 2 ){
        throw new Error("Minimum supported number of voters is 2.");
    }
    if( this._faulty_voters_cnt >= this._cntVoters){
      throw new Error("The number of faulty voters is bigger then the number of all voters.");
    }
}

Object.defineProperty(Authority.prototype, 'curve', {
  get: function () {
    return this._curve;
  }
})
Object.defineProperty(Authority.prototype, 'G', {
    get: function () {
      return this._G;
    }
})
Object.defineProperty(Authority.prototype, 'NN', {
    get: function () {
      return this._NN;
    }
})
Object.defineProperty(Authority.prototype, 'PP', {
  get: function () {
    return this._PP;
  }
})
Object.defineProperty(Authority.prototype, 'candidates', {
    get: function () {
      return this._candidates;
    }
})
Object.defineProperty(Authority.prototype, 'cand_generators', {
    get: function () {
      return this._cand_generators;
    }
})
Object.defineProperty(Authority.prototype, 'cntFaultyVoters', {
  get: function () {
    return this._faulty_voters_cnt;
  }
})
Object.defineProperty(Authority.prototype, 'cand_generators_1D_array', {
  get: function () {
    var ret = []
    this._cand_generators.forEach(f => {
      ret.push("0x" + f.x.toString(16));
      ret.push("0x" + f.y.toString(16));
    });
    // console.log("ret = ", ret)
    return ret;
  }
})
Object.defineProperty(Authority.prototype, 'cand_generatorsBI', {
    get: function () {
      return this._cand_generatorsBI;
    }
})
Object.defineProperty(Authority.prototype, 'deltaT', {
    get: function () {
      return this._deltaT;
    }
})
Object.defineProperty(Authority.prototype, 'cntVoters', {
    get: function () {
      return this._cntVoters;
    }
})
Object.defineProperty(Authority.prototype, 'deposit', {
    get: function () {
      return this._deposit;
    }
})

Authority.prototype.getCandNames = function(){
  let ret = [];
  this._cand_generators.forEach( (g, i) => {
    ret.push("Candidate with ID = " + i.toString());
  });
  return ret;
}


Authority.prototype.initCandGenerators = function(cnt_candidates){
  let ret = [];

  // according Hao et al. page 3
  const m = utils.computeExpofPowerOf2GreaterThanArg(this._cntVoters); // 2^m > |voters|  ; Baudron et al.
  
  for (let i = 0; i < cnt_candidates; i++) {
    var v_i = Math.pow(2, m * i);
    var Fx  = this._curve.multiply(this._G, BigInt(v_i));   
    ret.push(Fx);
  }
  console.log("Initializing cand generators", ret)
  return ret;
}

Authority.prototype.getVoterAddrs = function(accounts){
    var ret = [];
    // start from 1, since accounts[0] is authority
    for (let i = 1; i < this.cntVoters + 1; i++) {
        ret.push(accounts[i]);
    }
    return ret;
}

Authority.prototype.sumOfBVotes = function(){
  var sum = this._G;
  for (let j = 0; j < this._blindedVotes.length; j++) {
    sum = this._curve.add(sum, this._blindedVotes[j]);
  }
  return sum;
}

Authority.prototype.sumOfBVotes_FT = function(nonVotingIDXes, voters){
  var sum = this._G;
  for (let j = 0; j < voters.length; j++) {
    if(nonVotingIDXes.includes(j)){ // skip non-voting participants
      continue;
    }
    var repairedBlindedVote = voters[j]._bvote ;// voters[j].repairBlindedVote_FT(nonVotingIDXes, voters);    
    sum = this._curve.add(sum, repairedBlindedVote);
  }
  return sum;
}

Authority.prototype.expCandGens = function(tally){
  assert(tally.length == this._cand_generators.length);

  var sum = this._G;
  var prod;

  for (let j = 0; j < this._cand_generators.length; j++) {
    if(tally[j] != 0n){
      prod = this._curve.multiply(this._cand_generators[j], tally[j]);
      sum = this._curve.add(sum, prod);
    }
  }
  return sum;
}


// function makeCombinationIterator(_voters, candidates) {
//   let iterationCount = 0;
//   let voters = _voters;
//   let candidates = _candidates;
//   let endCondition = false;

//   let curtCombination = [];
//   for (let i = 0; i < voters; i++) {
//     curCombination.push(0);
//   }

//   const rangeIterator = {
//       next: function() {
//         let result;



//         if (false == endCondition) {

//           result = { value: nextCombination, done: false }
//           iterationCount++;
//           return result;
//         }
//         return { value: iterationCount, done: true }
//       }
//   };
//   return rangeIterator;
// }


module.exports = Authority;
