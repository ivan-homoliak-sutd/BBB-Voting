#!/bin/bash

CANDS=8
sed -i "s/CANDIDATES_CNT:.*/CANDIDATES_CNT: $CANDS,/g"  ./library/config.js
echo "CANDS=$CANDS"
for i in {60..100..10}
do
   batch=$i
   sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: \t$i,/g"  ./library/config.js
   sed -i "s/MPC_BATCH_SIZE:.*/MPC_BATCH_SIZE: \t$batch,/g"  ./library/config.js
   echo -n "$i: ";

   truffle test --bail --network advanced ./test/TestBCVoting.js > tmp.txt
   cat tmp.txt >> fulllog.txt

   grep "as used in computeTally by authority:" tmp.txt
done
