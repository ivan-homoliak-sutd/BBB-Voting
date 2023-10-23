pragma solidity ^0.5.8;

/**
 * @title CMath
 *
 * Functions for working with integers
 *
 * @author IH
 */
library CMath {

    uint constant MAX_NUMBER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    uint constant HIGHEST_BIT_NUMBER = 0x80000000000000000000000000000000;

    function mul_mod(uint a, uint b, uint m) internal pure returns (uint) {
        // TODO make this method to work with 256 bits

        assert(m < MAX_NUMBER && a < m && b < m);
        return (a * b) % m; // TODO: compare with embeded function later
        // return mulmod(a, b, m);
    }

    function add_mod(uint a, uint b, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER && a < MAX_NUMBER && b < MAX_NUMBER);
        return (a + b) % m; // TODO: compare with embeded function later
        // return addmod(a, b, m);
    }

    // function exp_mod_cache(uint b, uint m, uint[] memory cache) internal pure returns (uint) {
    //     assert(m < MAX_NUMBER);

    //     uint X = 1;
    //     uint B = b;
    //     uint i = 0;

    //     while(B >= 1) {
    //         if(B % 2 == 1){
    //             B -= 1;
    //             X = (cache[i] * X) % m;
    //         } else {
    //             B /= 2;
    //             i++;
    //         }
    //     }
    //     return X;
    // }

    function exp_mod(uint a, uint b, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER && a < m);

        uint X = 1;
        uint B = b;
        uint A = a;

        while(B >= 1) {
            // X serves as accumulator of the result
            if(B % 2 == 1){
                B -= 1;
                X = (A * X) % m;
            } else {
                B /= 2;
                A = (A * A) % m;
            }
        }
        return X;
    }

    // function exp_mod_unoptimized(uint a, uint exp, uint m) internal pure returns (uint) {
    //     assert(m < MAX_NUMBER && a < m);

    //     uint e = exp;
    //     uint i;
    //     uint resFin = 1;

    //     while(e > 0) {
    //         uint res = a;
    //         for (i = 2 ; i <= e; i = i * 2) {
    //             res = (res * res) % m;
    //         }
    //         e = e - (i / 2);
    //         resFin = (resFin * res) % m;
    //     }
    //     return resFin;
    // }

    /**
     * Performs product of an array, while considering modulus m
     */
    function prod_mod(uint[] memory items, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER);

        uint res = 1;
        for (uint i = 0; i < items.length; i++) {
            assert(items[i] < MAX_NUMBER);
            res = (res * items[i]) % m;
        }
        return res;
    }

    function inv_mod(uint a, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER && a < m);

        uint h = gcd(a, m); //  maybe we can skip this (saving of ~5k gas)
        require(h == 1, "Mod inverse of arguments does not exist.");

        // If a and m are relatively prime, then modulo inverse is a^(m-2) mode m
        h = power_mod(a, m - 2, m);

        if (h < 0){
            h = (h + m) % m;
        }
        assert(h > 0);
        return h;
    }

    function checkGenerator(uint g, uint m) internal pure returns (bool) {
        uint q = (m - 1) / 2;
        if(1 != exp_mod(g, q, m) && 1 != exp_mod(g, 2, m)){
            return true;
        }
        return false;
    }

    // function isPrime(uint g) internal pure returns (bool) {

    //     return true;
    // }

    // function checkMainGenerator(uint g, uint m) internal pure returns (bool) {
    //     uint q = (m - 1) / 2;
    //     if(1 != exp_mod(g, q, m)){
    //         return true;
    //     }
    //     return false;
    // }

    ///////////// AUX functions ////////////////

     function power_mod(uint x, uint y, uint m)  internal pure returns (uint) { // To compute x^y under modulo m
        if (y == 0){
            return 1;
        }
        uint p = power_mod(x, y / 2, m) % m;
        p = (p * p) % m;

        return (y % 2 == 0)? p : (x * p) % m;
    }

    function gcd(uint a, uint b)  internal pure returns (uint) {
        if (a == 0){
            return b;
        }
        return gcd(b % a, a);
    }

}