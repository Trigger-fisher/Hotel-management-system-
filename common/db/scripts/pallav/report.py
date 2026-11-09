import json,re,os,sys
P=sys.argv[1]
T=json.load(open('schema.json'))
def A(t,name,typ,args=(),mods=()):
    T.setdefault(t,{})[name]={'type':typ,'args':list(args),'mods':list(mods)}
# dynamic-table migrations (loops over table lists)
for t in ['staff_advances','shift_handovers']:A(t,'business_unit_id','foreignId',[],['nullable',"constrained='business_units'",'nullOnDelete'])
for t in 'hotel_cash_deposits food_cash_deposits hotel_cash_withdrawals food_cash_withdrawals hotel_misc_expenses food_misc_expenses staff_advances shift_handovers bill_master_bills bill_master_advances payroll_advances bonus_incentives employee_separations'.split():
    A(t,'entry_no','unsignedInteger',[],['nullable','index'])
for t in 'hotel_cash_deposits food_cash_deposits'.split():
    A(t,'revenue_source','string',['60'],['nullable']);A(t,'reason','string',['500'],['nullable'])
for t in 'hotel_misc_expenses food_misc_expenses'.split():A(t,'expense_head','string',['60'],['nullable'])
for t in 'hotel_cash_withdrawals food_cash_withdrawals'.split():A(t,'instruction','text',[],['nullable'])
A('users','deleted_at','timestamp',[],['nullable']);A('users','deleted_by','foreignId',[],['nullable'])
for t in 'employees shift_handovers bill_master_bills bill_master_advances company_profiles hotel_cash_deposits food_cash_deposits hotel_cash_withdrawals food_cash_withdrawals hotel_misc_expenses food_misc_expenses payroll_advances bonus_incentives employee_separations employee_meal_periods'.split():
    A(t,'deleted_at','timestamp',[],['nullable','index']);A(t,'deleted_by','unsignedBigInteger',[],['nullable'])
for c in ['bank_name','account_holder_name','account_number','ifsc_code','branch_name']:
    if c not in T.get('salary_processings',{}):A('salary_processings',c,'string',['120'],['nullable'])
# encrypted-at-rest columns widened to text
for t,cs in {'employees':['account_number','ifsc_code','id_proof_number','emergency_contact_number'],'payroll_companies':['account_number','ifsc_code'],'salary_processings':['account_number','ifsc_code'],'customers':['id_proof_number']}.items():
    for c in cs:A(t,c,'text',[],['nullable','ENCRYPTED'])
for c in['previous_value','new_value']:A('salary_update_histories',c,'text',[],['nullable'])
# salary FK ties cut (plain reference)
for t,cs in {'salary_processings':['employee_id','payroll_company_id'],'salary_update_histories':['employee_id']}.items():
    for c in cs:
        if c in T[t]:T[t][c]['mods']=[m for m in T[t][c]['mods'] if m!='constrained']+['PLAIN_REF_no_fk']
skip={'cache','cache_locks','jobs','job_batches','failed_jobs','password_reset_tokens','sessions','users','roles','role_permissions','user_permissions'}
# casts from models
casts={}
for root,_,fs in os.walk(P+'/app/Models'):
    for f in fs:
        s=open(os.path.join(root,f),encoding='utf8').read()
        m=re.search(r"protected \$table = '(\w+)'",s)
        if m:t=m.group(1)
        else:
            c=re.search(r'class (\w+)',s)
            if not c:continue
            n=re.sub(r'(?<!^)(?=[A-Z])','_',c.group(1)).lower()
            t=n+'s' if not n.endswith('y') else n[:-1]+'ies'
        cm=re.search(r"(?:\$casts\s*=|function casts\(\)[^{]*\{\s*return)\s*\[(.*?)\];",s,re.S)
        if cm:
            casts[t]={k:v for k,v in re.findall(r"'(\w+)'\s*=>\s*'?([\w:\\.]+)",cm.group(1))}
def pg(c):
    t,a,m=c['type'],c['args'],c['mods']
    nm=c.get('name','')
    if t=='id':return 'uuid PK'
    if t=='foreignId':
        return 'uuid'
    if t in('string',):return f"varchar({a[0]})" if a else 'varchar(255)'
    if t in('text','longText','mediumText'):return 'text'
    if t=='decimal':
        p,s=(a+['8','2'])[:2]
        return (f"numeric({p},{s}) NON-MONEY (hours/qty/pct)" if re.search(r'(^|_)hours?($|_)|percent|pct|qty|quantity|(^|_)days($|_|\d)|payable_days|factor|multiplier|weight',c.get('name','')) else f"bigint PAISE (was decimal({p},{s}))") if s=='2' else f"numeric({p},{s})"
    if t=='boolean':return 'boolean'
    if t=='date':return 'date'
    if t=='time':return 'time'
    if t in('timestamp','dateTime'):return 'timestamptz'
    if t=='json':return 'jsonb'
    if t=='enum':return 'text CHECK IN('+','.join(re.findall(r"'([^']*)'",' '.join(a)))+')' if a else 'text CHECK'
    if t=='integer':return 'integer'
    if t=='unsignedTinyInteger':return 'smallint CHECK>=0'
    if t=='unsignedSmallInteger':return 'integer CHECK 0..65535'
    if t=='unsignedInteger':return 'bigint CHECK>=0'
    if t=='unsignedBigInteger':return 'uuid? or bigint (check)'
    if t=='uuid':return 'uuid'
    return t
out=[]
n=0
for t in sorted(T):
    if t in skip:continue
    out.append(f"\n### {t}")
    for cn,c in T[t].items():
        if cn=='__idx':
            out.append("  indexes: "+'; '.join(c['args']));continue
        mods=[x.split('=')[0] for x in c['mods']]
        notes=[]
        if 'nullable' not in mods and c['type']!='id':notes.append('NOT NULL')
        for md in c['mods']:pass
        for x in c['mods']:
            if x.startswith('default='):notes.append('DEFAULT '+x[8:])
            if x.startswith('constrained='):notes.append('FK '+x[12:])
        c['name']=cn
        out.append(f"  {cn}: {pg(c)}"+(' | '+', '.join(notes) if notes else '')+' | '+'/'.join(x for x in mods if x in('unique','index','constrained','ENCRYPTED','PLAIN_REF_no_fk')))
    if t in casts:out.append("  model casts: "+', '.join(f"{k}={v}" for k,v in casts[t].items()))
open('columns.md','w',encoding='utf8').write('\n'.join(out))
print(len(T),len(out))

# ---- columns Pallav's later migrations drop through variable lists (replay cannot see them) ----
for t,cols in {'shift_handovers':['message_one','message_two','message_three','message_four','message_five','special_instruction']}.items():
    for c in cols: T[t].pop(c,None)
json.dump(T,open('final.json','w'),indent=1)
# the loop variable of salary_processings' bank-detail migration leaked into the replay as a column
T['salary_processings'].pop('$column', None)
json.dump(T,open('final.json','w'),indent=1)
