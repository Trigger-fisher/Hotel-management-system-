import re,os,json,sys
M=sys.argv[1]
tables={}   # name -> ordered dict col -> info
def addcol(t,name,typ,args,mods):
    tables.setdefault(t,{})[name]={'type':typ,'args':args,'mods':mods}
def balanced(s,i):
    d=0
    for j in range(i,len(s)):
        if s[j]=='(':d+=1
        elif s[j]==')':
            d-=1
            if d==0:return j
    return -1
COLM={'string','text','longText','mediumText','decimal','boolean','date','time','timestamp','dateTime','json','enum','integer','unsignedTinyInteger','unsignedInteger','unsignedSmallInteger','unsignedBigInteger','uuid','foreignId','bigInteger','float'}
def split_args(a):
    out=[];d=0;cur='';q=None
    for ch in a:
        if q:
            cur+=ch
            if ch==q:q=None
            continue
        if ch in "'\"":q=ch;cur+=ch;continue
        if ch in '([':d+=1
        if ch in ')]':d-=1
        if ch==',' and d==0:out.append(cur.strip());cur=''
        else:cur+=ch
    if cur.strip():out.append(cur.strip())
    return out
def strip(s):return s.strip().strip("'\"")
def handle_block(t,body,sub={}):
    # statements start with $table->
    for m in re.finditer(r'\$table->(\w+)\(',body):
        meth=m.group(1);s=m.start();e=balanced(body,m.end()-1)
        if e<0:continue
        args=split_args(body[m.end():e])
        # chain
        end=body.find(';',e);chain=body[e+1:end]
        mods=re.findall(r'->(\w+)\(([^)]*)\)',chain)
        # skip chain-in-chain matches: only handle at statement start
        pre=body[max(0,s-3):s]
        if '->' in pre.replace('$table->','') : continue
        def nm(a):
            a=strip(a)
            for k,v in sub.items():a=a.replace('{$'+k+'}',v).replace('{'+k+'}',v)
            return a
        mn=[x[0] for x in mods]
        if meth=='id':addcol(t,'id','id',[],mn)
        elif meth=='timestamps':addcol(t,'created_at','timestamp',[],['nullable']);addcol(t,'updated_at','timestamp',[],['nullable'])
        elif meth=='softDeletes':addcol(t,'deleted_at','timestamp',[],['nullable'])
        elif meth=='rememberToken':addcol(t,'remember_token','string',['100'],['nullable'])
        elif meth in COLM:
            extra=[x for x in mods if x[0] in('default','constrained')]
            addcol(t,nm(args[0]),meth,[nm(a) for a in args[1:]],[a+('='+b.strip() if b.strip() else '') for a,b in mods])
        elif meth=='dropColumn':
            for a in args:
                a=a.strip()
                if a.startswith('['):
                    for x in re.findall(r"'([^']+)'",a):tables.get(t,{}).pop(x,None)
                else:tables.get(t,{}).pop(strip(a),None)
        elif meth=='dropConstrainedForeignId':tables.get(t,{}).pop(strip(args[0]),None)
        elif meth=='dropSoftDeletes':tables.get(t,{}).pop('deleted_at',None)
        elif meth=='renameColumn':
            c=tables[t].pop(strip(args[0]));tables[t][strip(args[1])]=c
        elif meth in('unique','index'):
            tables.setdefault(t,{}).setdefault('__idx',{'type':'idx','args':[],'mods':[]})
            tables[t]['__idx']['args'].append(meth+':'+body[m.end():e])
for f in sorted(os.listdir(M)):
    src=open(os.path.join(M,f),encoding='utf8').read()
    up=src.split('public function down')[0]
    for m in re.finditer(r"Schema::(create|table)\((?:'(\w+)'|(\$\w+)|self::\w+)\s*,\s*function\s*\((?:Blueprint )?\$(?P<v>\w+)\)\s*(?:use\s*\([^)]*\)\s*)?\{",up):
        i=up.find('{',m.end()-1);d=0
        for j in range(i,len(up)):
            if up[j]=='{':d+=1
            elif up[j]=='}':
                d-=1
                if d==0:break
        body=up[i+1:j]
        v=m.group('v')
        if v!='table':body=body.replace('$'+v+'->','$table->')
        t=m.group(2)
        if not t:
            print('DYNAMIC',f,m.group(0)[:80],file=sys.stderr);continue
        if m.group(1)=='create':tables[t]={}
        # loops inside body
        loops=[]
        for lm in re.finditer(r"foreach\s*\(\s*(\[[^\]]*\]|range\(\d+,\s*\d+\))\s+as\s+\$(\w+)\)\s*\{",body):
            li=lm.end()-1;dd=0
            for k in range(li,len(body)):
                if body[k]=='{':dd+=1
                elif body[k]=='}':
                    dd-=1
                    if dd==0:break
            loops.append((lm.start(),k,lm.group(1),lm.group(2)))
        masked=body
        for a,b,lst,var in loops:
            inner=body[a:b+1]
            if lst.startswith('range'):
                lo,hi=map(int,re.findall(r'\d+',lst));vals=[str(x) for x in range(lo,hi+1)]
            else:vals=re.findall(r"'([^']*)'",lst)
            for v in vals:handle_block(t,inner,{var:v})
            masked=masked.replace(inner,' '*len(inner))
        handle_block(t,masked)
    for m in re.finditer(r"Schema::(drop|dropIfExists)\('(\w+)'\)",up):tables.pop(m.group(2),None)
json.dump(tables,open(sys.argv[2],'w'),indent=1)
print(len(tables),'tables')
