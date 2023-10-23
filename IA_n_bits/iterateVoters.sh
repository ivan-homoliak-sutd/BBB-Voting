#!/bin/bash

for i in {2..60}
do
   sed -i "s/VOTERS_CNT:.*/VOTERS_CNT: $i,/g"  ./library/config.js 
   echo -n "$i: ";
   truffle test --network advanced | grep "Gas used in computeMPCKeys"   
done
