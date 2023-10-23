let W3 = require('web3');
const crypto = require('crypto');

class Utils {

    constructor() {}

    exp_mod = function(a, b, m) {

        let X = 1n;
        let B = b;
        let A = a % m;

        while(B >= 1n) {
            if(B % 2n == 1n){
                B -= 1n;
                X = (A * X) % m;
            } else {
                B /= 2n;
                A = (A * A) % m;
            }
        }
        return X;
    }

    exp_mod_unoptimized = function(a, exp, m) {
        // assert(a < m && exp < m);

        let e = exp;
        let i;
        let resFin = 1n;

        while(e > 0n) {
            let res = a;
            for (i = 2n ; i <= e; i = i * 2n) {
                res = (res * res) % m;
            }
            e = e - (i / 2n);
            resFin = (resFin * res) % m;
        }
        return resFin;
    }

    inv_mod = function (a, m) {
        if(a < 0n || m < 0n){
            throw Error("inv_mod accepts only positive inputs.")
        }

        var g = this.gcd(a, m);
        if (g != 1n) {
            throw Error(`Mod inverse ${a} and ${m} does not exist.`)
        } else {
            // If a and m are relatively prime, then modulo inverse is a^(m-2) mode m
            let h = this.power_mod(a, m - 2n, m);
            // console.log(`h = ${h}`);
            if (h < 0n){
                h = (h + m) % m;
            }
            assert(h > 0n);
            return h;
        }
    }

    power_mod = function(x, y, m) { // To compute x^y under modulo m
        if (y == 0n){
            return 1n;
        }
        let p = this.power_mod(x, y / 2n, m) % m;
        p = (p * p) % m;

        return (y % 2n == 0n)? p : (x * p) % m;
    }

    gcd = function(a, b) {
        if (a == 0n)
            return b;
        return this.gcd(b % a, a);
    }

    buildPowersOfG = function (g, P){
        let bits = this.ByteSizeFittedToArgument(P) * 8;
        let res = g;
        let ret = [res];
        for (let i = 0; i < bits; i++) {
            res = (res * res) % P
            ret.push(res);
        }
        return ret;
    }

    concat = function(a, b) {
        if (typeof(a) != 'string' || typeof(b) != 'string' || a.substr(0, 2) != '0x' || b.substr(0, 2) != '0x') {
            console.log("a, b = ", a, b)
            throw new Error("Concat supports only hex string arguments");
        }
        console.log("a, b = ", a, b)
        a = hexToBytes(a);
        b = hexToBytes(b);
        let res = []

        for (let i = 0; i < a.length; i++) {
            res.push(a[i])
        }
        for (let i = 0; i < b.length; i++) {
            res.push(b[i])
        }

       return bytesToHex(res);
    }


    concatB32 = function(a, b) {
        if (typeof(a) != 'string' || typeof(b) != 'string' || a.substr(0, 2) != '0x' || b.substr(0, 2) != '0x') {
            console.log("a, b = ", a, b)
            throw new Error("ConcatB32 supports only hex string arguments");
        }
        a = hexToBytes(a);
        b = hexToBytes(b);
        var res = []
        if (a.length != b.length || a.length != 16 || b.length != 16 ) {
            throw new Error("ConcatB32 supports only equally-long (16B) arguments.");
       } else {
            for (var i = 0; i < a.length; i++) {
                res.push(a[i])
            }
            for (var i = 0; i < b.length; i++) {
                res.push(b[i])
            }
       }
       return bytesToHex(res);
      }

    // Convert a byte array to a hex string
    bytesToHex = function(bytes) {
        let hex = [];
        for (let i = 0; i < bytes.length; i++) {
            hex.push((bytes[i] >>> 4).toString(16));
            hex.push((bytes[i] & 0xF).toString(16));
        }
        // console.log("0x" + hex.join(""));
        return "0x" + hex.join("");
    }

    // Convert a hex string to a byte array
    hexToBytes = function(hex) {
        let bytes = [];
        for (let c = 2; c < hex.length; c += 2)
            bytes.push(parseInt(hex.substr(c, 2), 16));
        return bytes;
    }

    cloneArray = function(arr, convertToBigInt = false) {
        let ret = []
        for (let i = 0; i < arr.length; i++) {
            if(convertToBigInt){
                ret.push(BigInt(arr[i]));
            }else{
                ret.push(arr[i]);
            }
        }
        return ret
    }

    hex2ascii = function(_hex) {
        let hex = _hex.toString(); // force conversion
        let str = '';
        for (let i = 2; (i < hex.length && hex.substr(i, 2) !== '00'); i += 2)
            str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        return str;
    }

    xor = function(_a, _b) {
        let a = _a;
        let b = _b;
        if (typeof(a) != 'string' || typeof(b) != 'string' || a.substr(0, 2) != '0x' || b.substr(0, 2) != '0x') {
            throw new Error("XOR supports only hex string arguments");
        }
        if(a.length % 2 != 0 || b.length % 2 != 0){
            console.log(`\t a = ${a} | b = ${b}`);
            throw new Error("XOR supports only arguments of even length.");
        }

        a = this.hexToBytes(a);
        b = this.hexToBytes(b);
        var res = []
        if (a.length != b.length ) {
            console.log(`\t a = ${a} | b = ${b}`);
            throw new Error("XOR supports only equally-long arguments.");
       } else {
            for (var i = 0; i < a.length; i++) {
                res.push(a[i] ^ b[i])
            }
       }
       return this.bytesToHex(res);
    }

    xorBIArray = function(arr, paddingBytes) {
        if (!Array.isArray(arr) || arr.length < 2) {
            throw new Error("xorArray() supports only arrays (of length 2+)");
        }
        let hexArray = this.BIarrayToHex(arr, paddingBytes);
        // console.log("hexArray = ", hexArray);

        let res = hexArray[0];
        for (let i = 1; i < hexArray.length; i++) {
            res = this.xor(res, hexArray[i]);
        }
        return res;
    }

    getSizeInBytes = function(a) {
        if (typeof(a) != 'string' || a.substr(0, 2) != '0x') {
            throw new Error("getSizeInBytes() supports only hex string arguments");
        }
        if(a.length % 2 == 0){
            return (a.length - 2) / 2;
        }else{
            return (a.length - 1) / 2;
        }
    }

    randomBytes = function(modulus){
        let sizeB = this.ByteSizeFittedToArgument(modulus);

        let res = crypto.randomBytes(sizeB);
        while (res >= modulus) {
            res /= 2;
        }
        return "0x" + res.toString('hex')
    }


    round = function (x) {
        return Number.parseFloat(x).toFixed(2);
    }

    BIarrayToHex = function (arr, paddingBytes) {

        assert(Array.isArray(arr));
        let ret = [];
        arr.forEach(e => {
            assert(typeof e == "bigint");
            if (e.toString(16).length - 2 > paddingBytes * 2) {
                throw new Error(`Length of element ${e.toString(16)} is longer than padding in Bytes ${paddingBytes}`);
            }
            // console.log("BIarrayToHex element = ", e.toString(16));
            ret.push(this.toPaddedHex(e.toString(16), paddingBytes));
        });
        return ret;
    }

    toPaddedHex = function (item, paddingBytes){
        let pi = W3.utils.padLeft(item, paddingBytes * 2);
        // console.log(`pi = ${pi}`);
        return "0x" + pi;
    }

    sumBI = function(arr, module) {
        let s = BigInt(0);
        arr.forEach(element => {
            s = (s + element) % module;
        });
        return s;
    }

    ByteSizeFittedToArgument = function(P){
        if(typeof P != 'bigint'){
            throw Error("ByteSizeFittedToArgument() accepts only BigInt types.")
        }
        let tmpP = P;
        let bits = 0
        while (tmpP > 0) {
            tmpP = tmpP / 2n;
            bits++;
        }
        // console.log("ByteSizeFittedToArgument = ", bits);
        return Math.ceil((bits) / 8);
    }

    shaX = function(a, newSizeB) {
        let stdHashSizeB = 32; // 32B is the output size of sha256()

        // console.log("newSizeB = ", newSizeB);
        if(stdHashSizeB >= newSizeB){
            if (Array.isArray(a)){
                // console.log("soliditySha3: ", a)
                return W3.utils.soliditySha3(...a).substring(0, 2 + 2 * newSizeB);
            }
            return W3.utils.soliditySha3(a).substring(0, 2 + 2 * newSizeB);
        }else {
            // if modulus is bigger, we also need to accomodate the size of hash
            throw Error("Not Implemented");
        }
    }



}

Number.prototype.padLeft = function(size) {
    let s = this.toString(16)
    while (s.length < (size || 2)) {
        s = "0" + s;
    }
    return s;
}

module.exports = Utils;