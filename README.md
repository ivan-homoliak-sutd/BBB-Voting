# BBB-Voting - Self-Tallying End-to-End Verifiable 1-out-of-k Blockchain-Based Boardroom Voting

The repository contains source code of a few implementations from our paper published at IEEE Blockchain 2023, Hainan, China.

The preprint is available at: https://arxiv.org/abs/2010.09112

**Abstract**

Voting is a means to agree on a collective decision based on available choices (e.g., candidates), where participants agree to abide by their outcome. 
To improve some features of e-voting, decentralized blockchain-based solutions can be employed, where the blockchain represents a public bulletin board that in contrast to a centralized bulletin board provides extremely high availability, censorship resistance, and correct code execution.
A blockchain ensures that all entities in the voting system have the same view of the actions made by others due to its immutability and append-only features. 
The existing remote blockchain-based boardroom voting solution called Open Vote Network (OVN) provides the privacy of votes, universal \& End-to-End verifiability, and perfect ballot secrecy; however, it supports only 2 choices and lacks recovery from stalling participants. 

We present BBB-Voting, an equivalent blockchain-based approach for decentralized voting such as OVN, but in contrast to it, BBB-Voting supports 1-out-of-$k$ choices and provides robustness that enables recovery from stalling participants. 
We make a  cost-optimized implementation using an Ethereum-based environment respecting Ethereum Enterprise Alliance standards, which we compare with OVN and show that our work decreases the costs for voters by $13.5\%$ in normalized gas consumption.
Finally, we show how BBB-Voting can be extended to support the number of participants limited only by the expenses paid by the authority and the computing power to obtain the tally.

**Details**

We made two different base implementations (that were further parametrized): the first one  is based on DLP for integers modulo $p$ (denoted as integer arithmetic (IA)), and the second one is based on the elliptic curve DLP (denoted as ECC).
In the ECC, we used a standardized Secp256k1 curve from existing libraries.
In the case of IA, we used a dedicated library for operations with big numbers since EVM natively supports only 256-bit long words, which does not provide sufficient security level with respect to the DLP for integers modulo $p$ (Since this DLP was already computed for 795-bit long safe prime in 2019, only values higher than 795-bit are considered secure enough.)
We consider 1024 bits the minimal secure (library-supported) length of numbers in IA.

**Structure**  
Particular folders contain different implementations, as mentioned - in the evaluation section of the paper:

- **IA-256**:   IA implementation with native size of modulus (=256bits)   
- **IA_n_bits** IA implementation with arbitrary size of modulus (can be configured in ./library/config)
- **ECC_FT**: improved ECDSA implementation using Jacobi coordinates and modular inverse precomputation; additionally offerering fault tolerance


All folders are truffle projects and can be run after installing all dependencies by:

```
$ truffle test
```

**Cite as**
```
@inproceedings{homoliak2023-bbbVoting,  
    title={BBB-Voting: Self-Tallying End-to-End Verifiable 1-out-of-$k$ Blockchain-Based Boardroom Voting},  
    author={Homoliak, Ivan and Venugopalan, Sarad and Li, Zengpeng  and Szalachowski, Pawel},  
    booktitle={2023 IEEE International Conference on Blockchain (Blockchain)},     
    year={2023},  
    organization={IEEE}  
}