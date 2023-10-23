let Utils = require("./utils.js");
var utils = new Utils()
const BN = require('bn.js')

function h(a) { return W3.utils.soliditySha3({v: a, t: "bytes", encoding: 'hex' }); }


var Authority = function (_cnt_candidates, _cnt_voters, _G, _MODULUS, _DELTA_T, _DEPOSIT_AUTHORITY) {
    this._G = BigInt(_G);
    this._P = BigInt(_MODULUS);
    this._sizeP = utils.ByteSizeFittedToArgument(this._P);
    this._deltaT = _DELTA_T;
    this._deposit = _DEPOSIT_AUTHORITY;
    this._cand_generators = this.initCandGenerators(_cnt_candidates);
    this._cand_generatorsBI = utils.cloneArray(this._cand_generators, true);
    this._cntVoters = _cnt_voters;
    this._candidates = this.getCandNames();
    this._blindedVotes = []; // here will be stored blinded votes submitted by voters

    if (this._sizeP % 32 != 0){
        throw new Error(`The size of P must be divisible by 32B.`);
    }
    if (this._cntVoters < 2){
      throw new Error(`Minimum supported voters is 2.`);
    }

    if ((new BN(this._P.toString(16))).bitLength() < 248){
      throw new Error(`The size of modulus must be higher than 32B.`);
    }
}

Object.defineProperty(Authority.prototype, 'sizeP', {
  get: function () {
    return this._sizeP;
  }
})
Object.defineProperty(Authority.prototype, 'G', {
    get: function () {
      return this._G;
    }
})
Object.defineProperty(Authority.prototype, 'P', {
    get: function () {
      return this._P;
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
  let q = (this._P - 1n) / 2n
  let ret = [];

  for (let gen = 2n; gen < this._P && ret.length < cnt_candidates; gen++) {
    if(gen == this._G)
      continue

    let cond1 = utils.exp_mod(gen, q, this._P);
    let cond2 = utils.exp_mod(gen, 2n, this._P);
    if(cond1 != 1n && cond2 != 1n){
      ret.push(parseInt(gen.toString(), 10));
    }
  }
  // console.log("Initializing cand generators", ret)
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

Authority.prototype.prodOfBVotes = function(){
  let res = 1n;
  this._blindedVotes.forEach( v => {
    res = (res * v) % this._P;
  });
  return res;
}

Authority.prototype.expCandGens = function(tally){
  assert(tally.length == this._cand_generators.length);

  let res = 1n;
  this._cand_generators.forEach( (f, i) => {
    res = (res * utils.power_mod(BigInt(f), tally[i], this._P)) % this._P;
  });
  return res;
}

Authority.prototype.getCacheOfModInvMPC = function(voters){
  let modInvC = [];
  let cacheBitLens = [];
  voters.forEach(v => {
    let b = utils.BI2BNsolidity(v.cache_modinv_MPC, true);
    modInvC.push(b[0]);
    cacheBitLens.push(b[1]);
  });
  return [modInvC, cacheBitLens];
}

Authority.prototype.getCacheOfModInvCandGens = function(){
  let modInvC = [];

  this._cand_generatorsBI.forEach(gen => {
    let inv = utils.BI2BNsolidity(utils.inv_mod(gen, this._P));
    modInvC.push(inv[0]);
  });
  return modInvC;
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
