let W3 = require('web3');
// const provider = new W3.providers.HttpProvider('http://localhost:9545')
// const web3 = new W3(provider)
let Utils = require("./utils.js");
var utils = new Utils()


var Voter = function (_id, g, g_cands, _candidates, _curve, _address, _deposit) {
    this._id = _id;
    this._G = g;
    this._curve = _curve;
    this._deposit = _deposit;
    this._address = _address;
    this._candidates = utils.cloneArray(_candidates); // strings of candidates
    this._cand_generators = utils.cloneArray(g_cands, false); // array of f_l
    this._vote = undefined; // plaintext vote will be generated later
    this._vote = undefined; // blinded vote
    this._h = undefined; // MPC key - will be computed from ephemeral keys of others
    this._c = undefined; // hash of a and b parameters of proof
    this._sizeP = 32;
    // this._sizeHash = this._sizeP;
    // this._sizeD = utils.ByteSizeFittedToArgument(this._P) + 2; // +2 is just experimental, can be different (but more than P)
    // this._maxHashVal = 2 ** (this._sizeD * 8) - 1;

    // do manual generation of eph. private and public keys
    this._x = BigInt(utils.randomBytes(this._curve.n))
    this._G_pow_x =  this.curve.multiply(this._G, this._x);

    this._voted = false; 

    // var a = this._curve.multiply(this._G, 0n); // it is undefined
    // console.log("a = ", a);
    // var a = this._curve.substract(this._G, this._G); // it is undefined
    // console.log("a = ", a);
    // throw Error("Not Implemented")

    this._r = [];
    this._d = [];
    this._a = [];
    this._b = [];
}

Object.defineProperty(Voter.prototype, 'id', {
    get: function () {
      return this._id;
    }
})
Object.defineProperty(Voter.prototype, 'G', {
    get: function () {
      return this._G;
    }
})
Object.defineProperty(Voter.prototype, 'PP', {
    get: function () {
      return this._PP;
    }
})
Object.defineProperty(Voter.prototype, 'x', {
    get: function () {
      return this._x;
    }
})
Object.defineProperty(Voter.prototype, 'Gx', {
    get: function () {
      return this._G_pow_x;
    }
})
Object.defineProperty(Voter.prototype, 'Gx_as_pair', {
  get: function () {
    return ["0x" + this._G_pow_x.x.toString(16), "0x" + this._G_pow_x.y.toString(16)];
  }
})
Object.defineProperty(Voter.prototype, 'candidates', {
    get: function () {
      return this._candidates;
    }
})
Object.defineProperty(Voter.prototype, 'curve', {
  get: function () {
    return this._curve;
  }
})
Object.defineProperty(Voter.prototype, 'h', {
    get: function () {
      return this._h;
    }
})
Object.defineProperty(Voter.prototype, 'cand_generators', {
    get: function () {
      return this._cand_generators;
    }
})
Object.defineProperty(Voter.prototype, 'deposit', {
    get: function () {
      return this._deposit;
    }
})
Object.defineProperty(Voter.prototype, 'address', {
    get: function () {
      return this._address;
    }
})
Object.defineProperty(Voter.prototype, 'vote', {
    get: function () {
      return this._vote;
    }
})
Object.defineProperty(Voter.prototype, 'sizeP', {
  get: function () {
    return this._sizeP;
  }
})
Object.defineProperty(Voter.prototype, 'sizeHash', {
  get: function () {
    return this._sizeHash;
  }
})
Object.defineProperty(Voter.prototype, 'r', {
    get: function () {
      return this._r;
    }
})
Object.defineProperty(Voter.prototype, 'd', {
    get: function () {
      return this._d;
    }
})
Object.defineProperty(Voter.prototype, 'a', {
    get: function () {
      return this._a;
    }
})
Object.defineProperty(Voter.prototype, 'b', {
    get: function () {
      return this._b;
    }
})
Object.defineProperty(Voter.prototype, 'c', {
    get: function () {
      return this._c;
    }
})

Voter.prototype.computeMpcPK = function(ephemeralPKs){

  var sum_1 = this._G;
  for (let j = 0; j < this._id; j++) {
    sum_1 = this._curve.add(sum_1, ephemeralPKs[j]);
  }

  var sum_2 = this._G;
  for (let j = this._id + 1; j < ephemeralPKs.length; j++) {
    sum_2 = this._curve.add(sum_2, ephemeralPKs[j]);
  }
  // console.log("numerator, denominator = ", numerator, denominator);
  this._h =   this._curve.subtract(sum_1, sum_2);
  console.log(`\t The voter[${this._id}] computed his MPC PK  (i.e. h) =  ${this._h}`);
}


Voter.prototype.computeBlindKeyForVoter = function(faultyPK){
  var res = this._curve.multiply(faultyPK, this._x);
  return [utils.toPaddedHex(res.x, 32), utils.toPaddedHex(res.y, 32)];
}

Voter.prototype.computeZKproofs4FT = function(nonVotingIDXes, voters){

  var proof_r = [];
  var proof_m1 = [];
  var proof_m2 = [];
  var hashes = [];

  for (let i = 0; i < nonVotingIDXes.length; i++) {    
    const f = nonVotingIDXes[i];

    const B = voters[f].Gx;
    const w = BigInt(utils.randomBytes(this._curve.n)); // sample random number
    const m1 = this._curve.multiply(this._G, w);
    const m2 = this._curve.multiply(B, w);
    proof_m1.push(m1);
    proof_m2.push(m2);
    
    let inputForHash = [];  
    inputForHash.push(utils.toPaddedHex(this.Gx.x.toString(16), 32), utils.toPaddedHex(this.Gx.y.toString(16), 32));            
    inputForHash.push(utils.toPaddedHex(B.x.toString(16), 32), utils.toPaddedHex(B.y.toString(16), 32));
    inputForHash.push(utils.toPaddedHex(m1.x.toString(16), 32), utils.toPaddedHex(m1.y.toString(16), 32));
    inputForHash.push(utils.toPaddedHex(m2.x.toString(16), 32), utils.toPaddedHex(m2.y.toString(16), 32));    
    let c = W3.utils.toBN(utils.shaX(inputForHash, this._sizeP));
    hashes.push(BigInt(c));
    console.log(`\t\t h(A, B, m1, m2) = ${c.toString(16)} | type = `, typeof(c));

    let cx = (this.x * BigInt(c)) % this._curve.n;
    let r = (cx + w) % this._curve.n;   
    proof_r.push(r);
  }  

  return [
      utils.BIarrayToHex(proof_r, this._sizeP), // this will replaced by decomposed scalars
      utils.BIarrayToHex(hashes, this._sizeP), // this will be replaced by decomposed scalars
      utils.ECPointsArrayToHex(proof_m1, this._sizeP),
      utils.ECPointsArrayToHex(proof_m2, this._sizeP),      
  ];
}

Voter.prototype.repairBlindedVote_FT = function(nonVotingIDXes, voters){

  // subtract or add blinding key G x_i x_j to the current blinding vote
  for (let i = 0; i < nonVotingIDXes.length; i++) {
    var blindingKey = this._curve.multiply(voters[nonVotingIDXes[i]].Gx, this.x);
    if(nonVotingIDXes[i] < this.id){
      this._bvote = this._curve.subtract(this._bvote, blindingKey);
    }else{
      this._bvote = this._curve.add(this._bvote, blindingKey);
    }        
  }
  return this._bvote;
}


Voter.prototype.getBlindedVote = function(){
    console.log(`\t getBlindedVote for voter[${this._id}], h = ${this._h} | x = ${this._x}`);
    // let P_int = parseInt(this._P.toString(), 10); // BigInt converted to Int
    this._vote = Math.floor(Math.random() * this._candidates.length);

    this._bvote = this._curve.add(this._curve.multiply(this._h, this._x), this._cand_generators[this._vote]);
    console.log(`\t The voter[${this._id}] votes for candidate ${this._vote} | bvote = ${this._bvote}`)

    let w = BigInt(utils.randomBytes(this._curve.n));

    for (let i = 0; i < this.candidates.length; i++) {
        console.log(`\t Processing candidate[${i}]...`)
        if(i != this._vote){
            var r =  BigInt(utils.randomBytes(this._curve.n));
            var d = BigInt(utils.randomBytes(this._curve.n));

            var a = this._curve.subtract(
              this._curve.multiply(this._G, r),
              this._curve.multiply(this._G_pow_x, d)
            )
            b = this._curve.subtract(
              this._curve.add(
                this._curve.multiply(this._h, r),
                this._curve.multiply(this._cand_generators[i], d) // TODO: check whether F_l is the gen of the vote or just the on in the cycle
              ),
              this._curve.multiply(this._bvote, d)
            )
        } else{
            var a = this._curve.multiply(this._G, w);
            var b = this._curve.multiply(this._h, w);
            var r = undefined;
            var d = 0n;
        }
        this._a.push(a);
        this._b.push(b);
        this._r.push(r);
        this._d.push(d);
    }
    // console.log("\t\t a = ", this._a);
    // console.log("\t\t b = ", this._b);

    let inputForHash = [];
    this._a.forEach(e => {
        inputForHash.push(utils.toPaddedHex(e.x.toString(16), 32));
        inputForHash.push(utils.toPaddedHex(e.y.toString(16), 32));
        // assert(e < this._curve.n);
    });
    this._b.forEach(e => {
        inputForHash.push(utils.toPaddedHex(e.x.toString(16), 32));
        inputForHash.push(utils.toPaddedHex(e.y.toString(16), 32));
        // assert(e < this._curve.n);
    });
    this._c = W3.utils.toBN(utils.shaX(inputForHash, this._sizeP));
    console.log(`\t\t c = ${this._c.toString(16)}`);

    // Adjust d and r for the candidate that the voter vote for

    let tmpXor = utils.xorBIArray(this._d, 32);
    this._d[this._vote] = BigInt(utils.xor(utils.toPaddedHex(this._c, 32), tmpXor));


    // if(this._d[this._vote] < 0){ // this is related only when we substract from sum; not to XOR.
    //   console.log(`\t\t c = ${this._c} and this._d[this._vote] = ${this._d[this._vote]}`);
    //   throw new Error("C is too small!");
    // }
    // console.log("this._d = ", this._d);
    this._r[this._vote] = (this._x * this._d[this._vote] + w) % this._curve.n;

    for (let i = 0; i < this._candidates.length; i++) {
        console.log(`\t\t proof for candidate[${i}] is: a = ${this._a[i]} | b = ${this._b[i]} | r = ${this._r[i]} | d = ${this._d[i]}`)
    }

    return [
        utils.BIarrayToHex(this._d, this._sizeP),
        utils.ECPointsArrayToHex(this._a, this._sizeP),
        utils.ECPointsArrayToHex(this._b, this._sizeP),
        utils.BIarrayToHex(this._r, this._sizeP), // here will be stored decomposed scalars of r
        [], // here will be stored decomposed scalars of d
        // utils.BIarrayInvertAndHex(this._d, this._curve.n), // here will be stored decomposed scalars of -d: this is not required since it is enough to invert decomposed values
        [utils.toPaddedHex(this._bvote.x, 32), utils.toPaddedHex(this._bvote.y, 32)],
    ];
}

module.exports = Voter;
