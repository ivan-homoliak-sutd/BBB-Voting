#!/bin/bash

for i in {2..20}
do
   sed -i "s/CANDIDATES_CNT:.*/CANDIDATES_CNT: $i,/g"  ./library/config.js
   echo -n "$i: ";
   truffle test --network advanced > tmp.txt

   cat tmp.txt | grep "AVERAGE gas used in submit vote:"
   echo -n "$i: ";
   cat tmp.txt | grep "Gas used in computeTally by authority:"

done
