var W3 = require('web3');
var BCVoting = artifacts.require("BCVoting");
var BCVotingFactory = artifacts.require("BCVotingFactory");
const EC = artifacts.require("EC");
const FastEcMul = artifacts.require("FastEcMul");


var ac = require("../library/config.js"); // Config of unit test authenticator
var Authority = require("../library/authority.js");
var auth = new Authority(ac.CANDIDATES_CNT, ac.VOTERS_CNT, ac.Gx, ac.Gy, ac.NN, ac.PP , ac.DELTA_T, ac.DEPOSIT_AUTHORITY, ac.FAULTY_VOTERS);

module.exports = function (deployer, network, accounts) {
    var authority_address;

    if(network == "mainnet") {
        throw "Halt. Sanity check. Not ready for deployment to mainnet.";
    }
    else if(network == "ropsten"){
        // authority = "0x41bE05ee8D89c0Bc9cA87faC4488ad6e6A06D97E"
        authority_address = null;
    }else{ // development & test networks
        console.log("Deploying contract to network: ", network);
        authority_address = accounts[0];
    }

    //deploy and link libraries first
    console.log("Deploying libraries...")
    deployer.deploy(EC, { gas: 5 * 1000 * 1000 });
    deployer.link(EC, FastEcMul);
    deployer.deploy(FastEcMul, { gas: 5 * 1000 * 1000 });
    deployer.link(EC, BCVoting);
    deployer.link(FastEcMul, BCVoting);


    console.log('Deploying BCVoting to network', network, 'from', authority_address);
    console.log("\t --authority's address is ", authority_address,
                ";\n\t --batch size is ", ac.MPC_BATCH_SIZE,
                ";\n\t --deltaT is ", auth.deltaT,
                ";\n\t --candidates are ", auth.candidates,
                ";\n\t --number of voters is ", ac.VOTERS_CNT,
                ";\n\t --generators of candidates are ", auth.cand_generators
    );

    result = deployer.deploy(BCVoting,
        auth.candidates,
        auth.cand_generators_1D_array,
        auth.deltaT,
        ac.MPC_BATCH_SIZE,
        { from: authority_address, gas: 8 * 1000 * 1000 }
    ).then(() => {
        console.log('Deployed BCVoting with address', BCVoting.address);
        console.log("\t \\/== Default gas estimate:", BCVoting.class_defaults.gas); //class_defaults        
    });
    

    // Deploy factory contract
    console.log('Deploying BCVotingFactory to network', network, 'from', authority_address);
    deployer.link(BCVoting, BCVotingFactory);
    deployer.link(EC, BCVotingFactory);
    deployer.link(FastEcMul, BCVotingFactory);

    result = deployer.deploy(BCVotingFactory, { gas: 10 * 1000 * 1000 }
    ).then(() => {
        console.log('Deployed BCVotingFactory with address', BCVotingFactory.address);
        console.log("\t \\/== Default gas estimate:", BCVotingFactory.class_defaults.gas); //class_defaults
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