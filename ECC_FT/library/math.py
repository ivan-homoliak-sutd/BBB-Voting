#!/usr/bin/env python
# Description: The script shortens all given names in author fields of input bibtext file.
# 
# Author: Ivan Homoliak

import sys
reload(sys)
sys.setdefaultencoding('utf8')

def exp_mod(a, exp, m):
    e = exp;
    i = None
    resFin = 1
    assert a < m and exp < m

    while e > 0:
        res = a;
        
        i = 2
        while i <= e:
            res = (res ** 2) % m;
            i = i * 2 


        e = e - (i / 2);
        # print "i after inner loop ", i
        print "e after inner loop ", e

        resFin = (resFin * res) % m;
    
    return resFin;



def main():
    print exp_mod(2, 1241886, 2698727)
    

if __name__ == "__main__":
    main()
