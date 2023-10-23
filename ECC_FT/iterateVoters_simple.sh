#!/bin/bash

for i in {100..220..10}
do    
   batch=$i

   sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: \t$i,/g"  ./library/config.js
   sed -i "s/MPC_BATCH_SIZE:.*/MPC_BATCH_SIZE: \t$batch,/g"  ./library/config.js
   echo -n "$i: ";

   truffle test --bail --network advanced ./test/TestBCVoting.js > tmp.txt
   cat tmp.txt >> fulllog.txt

   grep "Gas used in enrollVoters:" tmp.txt
   #grep "Gas used in enrollVoters" tmp.txt

done


# for i in {50..1000..50}
# do
#    batch=`echo "($i/3+1)" | bc`
#    echo -n "batch size= $batch, ";
#    sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: \t$i,/g"  ./library/config.js
#    sed -i "s/MPC_BATCH_SIZE:.*/MPC_BATCH_SIZE: \t$batch,/g"  ./library/config.js
#    echo -n "$i: ";
#    truffle test --network advanced | grep "SUM of gas used in submit eph key"
# 
# done
