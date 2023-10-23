#!/bin/bash

batch=100


for i in {500..1000..100}
do    
   sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: \t$i,/g"  ./library/config.js
   sed -i "s/MPC_BATCH_SIZE:.*/MPC_BATCH_SIZE: \t$batch,/g"  ./library/config.js
   echo -n "$i: ";

   truffle test --network advanced > tmp.txt
   cat tmp.txt >> fulllog.txt

   grep "SUM of gas used in compute MPC key" tmp.txt
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
