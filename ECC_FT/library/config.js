var Config = Object.freeze({
    CANDIDATES_CNT: 2,
    VOTERS_CNT: 	10,
    FAULTY_VOTERS: 	0,
    Gx: "0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", // generator for voters
    Gy: "0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", // generator for voters
    NN: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", // modulus for private keys (i.e., order of G)
    PP: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", // modulus for public keys (i.e., field size)
    LAMBDA: "0x5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72", // root of the characteristic polynomial of an endomorphism of the curve
    DELTA_T:            100000000,
    MPC_BATCH_SIZE: 	10,
    DEPOSIT_AUTHORITY:  10000,
    VOTER_DEPOSIT:      1000,    
})

module.exports = Config;