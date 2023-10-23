pragma solidity ^0.5.8;

/**
 * @title CMath
 *
 * Functions for working with integers
 *
 * @author IH
 */
library CMath {

    uint constant MAX_NUMBER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    function exp_mod(uint a, uint b, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER && a < m);

        uint X = 1;
        uint B = b;
        uint A = a;

        while(B >= 1) {
            // X serves as accumulator of the result
            if(B % 2 == 1){
                B -= 1;
                X = mulmod(A, X, m);
            } else {
                B /= 2;
                A = mulmod(A, A, m);
            }
        }
        return X;
    }

    function inv_mod(uint a, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER && a < m);

        // uint h = gcd(a, m); //  maybe we can skip this (saving of ~5k gas)
        // require(h == 1, "Mod inverse of arguments does not exist.");

        // If a and m are relatively prime, then modulo inverse is a^(m-2) mode m
        uint h = exp_mod(a, m - 2, m);

        if (h < 0){
            h = addmod(h, m, m);
        }
        assert(h > 0);
        return h;
    }

    /**
     * Performs product of an array, while considering modulus m
     */
    function prod_mod(uint[] memory items, uint m) internal pure returns (uint) {
        assert(m < MAX_NUMBER);

        uint res = 1;
        for (uint i = 0; i < items.length; i++) {
            assert(items[i] < MAX_NUMBER);
            res = mulmod(res, items[i], m);
        }
        return res;
    }

    function checkGenerator(uint g, uint m) internal pure returns (bool) {
        uint q = (m - 1) / 2;
        if(1 != exp_mod(g, q, m) && 1 != exp_mod(g, 2, m)){
            return true;
        }
        return false;
    }

    // function checkMainGenerator(uint g, uint m) internal pure returns (bool) {
    //     uint q = (m - 1) / 2;
    //     if(1 != exp_mod(g, q, m)){
    //         return true;
    //     }
    //     return false;
    // }

    ///////////// AUX functions ////////////////

    function gcd(uint a, uint b)  internal pure returns (uint) {
        if (a == 0){
            return b;
        }
        return gcd(b % a, a);
    }

}