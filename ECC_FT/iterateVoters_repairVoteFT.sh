#!/bin/bash

CANDIDATES=2 # minimize the number of candidates since this is not the point of this experiment

# truffle compile --network advanced # avoid later recompilation by this line

sed -i "s/CANDIDATES_CNT:.*/CANDIDATES_CNT: $CANDIDATES,/g"  ./library/config.js

# iterate various # of faulty voters
echo "Iterating over faulty voters"
for f in {1..10}
do
   all=$((f + 2))
   echo "all voters = $all and faulty voters = $f"
   sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: \t$all,/g"  ./library/config.js
   sed -i "s/FAULTY_VOTERS:.*/FAULTY_VOTERS: \t$f,/g"  ./library/config.js
   sed -i "s/MPC_BATCH_SIZE:.*/MPC_BATCH_SIZE: \t$all,/g"  ./library/config.js
   
   echo -n "$f: ";
   truffle test --network advanced ./test/TestBCVotingFT.js > tmp.txt
   cat tmp.txt >> fulllog.txt

   cat tmp.txt | grep "AVERAGE gas used in repair vote:"
   #echo -n "$i: ";
   #cat tmp.txt | grep "Gas used in computeTally by authority:"

done
