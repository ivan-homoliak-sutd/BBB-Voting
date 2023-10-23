let W3 = require('web3');
// const provider = new W3.providers.HttpProvider('http://localhost:9545')
// const web3 = new W3(provider)
let Utils = require("./utils.js");
var utils = new Utils()


var Voter = function (_id, g, g_cands, _candidates, modulus, _address, _deposit, _ephPK = false, _ephSK = false) {
    this._id = _id;
    this._G = BigInt(g);
    this._P = BigInt(modulus);
    this._deposit = _deposit;
    this._address = _address;
    this._candidates = utils.cloneArray(_candidates); // strings of candidates
    this._cand_generators = utils.cloneArray(g_cands, true); // array of f_l
    this._vote = undefined; // plaintext vote will be generated later
    this._h = undefined; // MPC key - will be computed from ephemeral keys of others
    this._c = undefined; // hash of a and b parameters of proof
    this._sizeP = utils.ByteSizeFittedToArgument(this._P);
    this._sizeHash = this._sizeP;
    // this._sizeD = utils.ByteSizeFittedToArgument(this._P) + 2; // +2 is just experimental, can be different (but more than P)
    // this._maxHashVal = 2 ** (this._sizeD * 8) - 1;

    if(_ephPK && _ephSK){
        this._x = BigInt(_ephSK);
        this._G_pow_x = BigInt(_ephPK);
    }else{
        // do manual generation of eph. key later
        this._x = BigInt(utils.randomBytes(this._P))
        this._x = this._x % this._P;
        this._G_pow_x = utils.exp_mod(this._G, this._x, this._P);
    }
    // console.log("2 mod 19 = ", utils.inv_mod(5n, 19n));
    // console.log("2 mod 19 = ", utils.power_mod(2n, 36n, 19n));
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
Object.defineProperty(Voter.prototype, 'P', {
    get: function () {
      return this._P;
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
Object.defineProperty(Voter.prototype, 'candidates', {
    get: function () {
      return this._candidates;
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

  var numerator = 1n;
  for (let j = 0; j < this._id; j++) {
      numerator = (numerator * ephemeralPKs[j]) % this._P;
  }

  var denominator = 1n;
  for (let j = this._id + 1; j < ephemeralPKs.length; j++) {
      denominator = (denominator * ephemeralPKs[j]) %  this._P;
  }
  // console.log("numerator, denominator = ", numerator, denominator);
  this._h =  (numerator * utils.inv_mod(denominator, this._P)) % this._P;
  console.log(`\t The voter[${this._id}] computed his MPC key (i.e. h) =  ${this._h}`);
}

Voter.prototype.getBlindedVote = function(){
    console.log(`\t getBlindedVote for voter[${this._id}], h = ${this._h} | x = ${this._x} | P = ${this._P}`);
    // let P_int = parseInt(this._P.toString(), 10); // BigInt converted to Int
    this._vote = Math.floor(Math.random() * this._candidates.length);

    // console.log("\t\t x^{-1} = ", utils.exp_mod(this._h, this._x, this._P));
    this._bvote = (
            utils.exp_mod(this._h, this._x, this._P) *
            this._cand_generators[this._vote]
    ) % this._P;
    console.log(`\t The voter[${this._id}] votes for candidate ${this._vote} | bvote = ${this._bvote}`)

    let w = BigInt(utils.randomBytes(this._P));
    // TODO, uncomment: BigInt(Math.floor(Math.random() * P_int));

    for (let i = 0; i < this.candidates.length; i++) {
        // console.log(`\t Processing candidate[${i}]...`)
        if(i != this._vote){
            var r =  BigInt(utils.randomBytes(this._P));
            var d = BigInt(utils.randomBytes(this.P));
            // console.log("\t\t x^{-1} = ", utils.inv_mod(this._G_pow_x, this._P));
            // console.log("\t\t x^{-d_l} = ", utils.exp_mod(utils.inv_mod(this._G_pow_x, this._P), d, this._P));
            // console.log("\t\t g^{r_l} = ", utils.exp_mod(this._G, r, this._P) );
            var a = (
                  utils.exp_mod(utils.inv_mod(this._G_pow_x, this._P), d, this._P)
                  *  utils.exp_mod(this._G, r, this._P)
                ) % this._P;


            let invF = utils.inv_mod(this._cand_generators[i], this._P);
            // console.log("\t\t f^{-1} = ", invF);
            var b = (this._bvote * invF) % this._P;
            // console.log("\t\t f^{-1} * B = ", b);
            b = (
                  utils.exp_mod(this._h, r, this._P) *
                  utils.exp_mod(utils.inv_mod(b, this._P), d, this._P)
                ) % this._P;
        } else{
            var a = utils.exp_mod(this._G, w, this._P);
            var b = utils.exp_mod(this._h, w, this._P);
            var r = undefined;
            var d = 0n;
        }
        this._r.push(r);
        this._d.push(d);
        this._a.push(a);
        this._b.push(b);
    }
    // console.log("\t\t a = ", this._a);
    // console.log("\t\t b = ", this._b);

    let inputForHash = [];
    this._a.forEach(e => {
        inputForHash.push(utils.toPaddedHex(e.toString(16), 32));
        assert(e < this._P);
    });
    this._b.forEach(e => {
        inputForHash.push(utils.toPaddedHex(e.toString(16), 32));
        assert(e < this._P);
    });
    this._c = W3.utils.toBN(utils.shaX(inputForHash, this._sizeHash));
    // let sizeC = utils.getSizeInBytes(W3.utils.toHex(this._c)) ; // in Bytes
    console.log(`\t\t c = ${this._c.toString(16)}`);


    // Adjust d and r for the candidate that the voter vote for
    // this._d[this._vote] = BigInt(this._c) - utils.sumBI(this._d, this._P);

    let tmpXor = utils.xorBIArray(this._d, this.sizeP);
    this._d[this._vote] = BigInt(utils.xor(utils.toPaddedHex(this._c, this.sizeP), tmpXor));

    if(this._d[this._vote] < 0){
      console.log(`\t\t c = ${this._c} and this._d[this._vote] = ${this._d[this._vote]}`);
      throw new Error("C is too small!");
    }
    // console.log("this._d = ", this._d);
    this._r[this._vote] = (
          (w + (this._x * this._d[this._vote]) ) % (this._P - 1n)
    );

    // for (let i = 0; i < this._candidates.length; i++) {
    //     console.log(`\t\t proof for candidate[${i}] is: a = ${this._a[i]} | b = ${this._b[i]} | r = ${this._r[i]} | d = ${this._d[i]}`)
    // }

    return [
        this._bvote.toString(),
        // "0x" + this._c.toString(16), // W3.utils.toHex(this._c),
        utils.BIarrayToHex(this._a, this._sizeP),
        utils.BIarrayToHex(this._b, this._sizeP),
        utils.BIarrayToHex(this._r, this._sizeP), // expression for the voted r is bigger due to multiplication by x
        utils.BIarrayToHex(this._d, this._sizeP),
        // utils.BIarrayToHex(utils.buildPowersOfG(this._G, this._P), this.sizeP),
    ];
}

module.exports = Voter;
