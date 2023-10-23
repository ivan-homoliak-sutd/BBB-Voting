var Config = Object.freeze({
    CANDIDATES_CNT:     3,
    VOTERS_CNT:         4,
    G:                  "0x02", //generator for voters
    // MODULUS:         2698727, // public modulus for voters
    // MODULUS:            "0x8cd5f08f41c234cd", // 64 bits
    // MODULUS:         "0x5c9337d587829fdb2fefd0029da12ceb", // 127bits
    // MODULUS:         "0x1e2a8d4f4b74ff5c41420dc47", // 100 bits
    // MODULUS:         "0x61b274c6f8fae4e5eed9e2f23e5599", // 120 bits
    MODULUS:            "0x40000000000000000000000000000337", // 127 bits
    DELTA_T:            100,
    DEPOSIT_AUTHORITY:  10000,
    VOTER_DEPOSIT:      1000,
})

module.exports = Config;