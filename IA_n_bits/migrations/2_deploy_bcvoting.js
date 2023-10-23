var W3 = require('web3');
var BCVoting = artifacts.require("BCVoting");
// const CMath = artifacts.require("CMath");
const BN = artifacts.require("BN");
const Memory = artifacts.require("Memory");

let Utils = require("../library/utils.js");
var utils = new Utils()

var ac = require("../library/config.js"); // Config of unit test authenticator
var Authority = require("../library/authority.js");
var auth = new Authority(ac.CANDIDATES_CNT, ac.VOTERS_CNT, ac.G, ac.MODULUS, ac.DELTA_T, ac.DEPOSIT_AUTHORITY);

module.exports = function (deployer, network, accounts) {
    var authority_address;

    if(network == "mainnet") {
        throw "Halt. Sanity check. Not ready for deployment to mainnet.";
    }
    else if(network == "ropsten"){
        // authority = "0x41bE05ee8D89c0Bc9cA87faC4488ad6e6A06D97E"
    }else{ // development & test networks
        console.log("Deploying contract to network: ", network);
        authority_address = accounts[0];
    }

    //deploy and link libraries first
    console.log("Deploying libraries...")
    deployer.deploy(BN, { gas: 5 * 1000 * 1000 });
    deployer.deploy(Memory, { gas: 5 * 1000 * 1000 });
    deployer.link(BN, BCVoting);
    deployer.link(Memory, BCVoting);

    console.log('Deploying BCVoting to network', network, 'from', authority_address);
    console.log("\t --authority's address is ", authority_address,
                ";\n\t --deltaT is ", auth.deltaT,
                ";\n\t --modulus P is ", auth.P.toString(16),
                ";\n\t --size of P is ", auth.P.toString(16).length / 2,
                ";\n\t --generator for voters G is ", auth.G.toString(16),
                ";\n\t --candidates are ", auth.candidates,
                ";\n\t --generators of candidates are ", auth.cand_generators
    );

    result = deployer.deploy(BCVoting,
        auth.candidates,// constructor(BN.instance memory modulus, bytes memory a_val, uint a_bitlen)
        auth.cand_generators,
        auth.getCacheOfModInvCandGens(),
        ...utils.BI2BNsolidity(auth.P),
        auth.G.toString(), // parseInt(auth.G.toString()),
        auth.deltaT,
        auth.P.toString(16).length / 2,
        { from: authority_address, gas: 16.5 * 1000 * 1000 }
    ).then(() => {
        console.log('Deployed BCVoting with address', BCVoting.address);
        console.log("\t \\/== Default gas estimate:", BCVoting.class_defaults.gas); //class_defaults
    });

};


// NOTES
//
// var W3 = require('web3');
//
// BCVoting.deployed().then(function(instance){return instance.someFunction()});
// BCVoting.deployed().then(function(instance){return instance.someFunction.call()});
// BCVoting.deployed().then(function(instance){return instance.authority()});
// BCVoting.deployed().then(function(instance){return instance.someFunction()}).then(function(value){return value.toNumber()});

// Access migrated instance of contract
// BCVoting.deployed().then(function(instance) {console.log(instance); });
//
// Get its balance
// W3.utils.fromWei(web3.eth.getBalance('0x82d50ad3c1091866e258fd0f1a7cc9674609d254').toString(), 'ether');