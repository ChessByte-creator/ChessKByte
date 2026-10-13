import sqlite3, random, os
random.seed(7)
games=[]; cur=None
for line in open('/tmp/ref.txt'):
    if line.startswith('G '):
        cur=bytearray(); games.append(cur)
    elif line.startswith('P '):
        cur.append(int(line.split()[1]))
games=[bytes(g[:120]) for g in games if len(g)>=20]
print(len(games),'jogos base')
if os.path.exists('/tmp/ec-test.db3'): os.remove('/tmp/ec-test.db3')
db=sqlite3.connect('/tmp/ec-test.db3')
db.executescript('''
CREATE TABLE Info (Name TEXT UNIQUE NOT NULL, Value TEXT);
CREATE TABLE Events (ID INTEGER PRIMARY KEY, Name TEXT UNIQUE);
CREATE TABLE Sites (ID INTEGER PRIMARY KEY, Name TEXT UNIQUE);
CREATE TABLE Players (ID INTEGER PRIMARY KEY, Name TEXT UNIQUE, Elo INTEGER);
CREATE TABLE Games (ID INTEGER PRIMARY KEY, EventID INTEGER, SiteID INTEGER, Date TEXT, Time TEXT, Round TEXT,
 WhiteID INTEGER, WhiteElo INTEGER, BlackID INTEGER, BlackElo INTEGER, WhiteMaterial INTEGER, BlackMaterial INTEGER,
 Result INTEGER, TimeControl TEXT, ECO TEXT, PlyCount INTEGER, FEN TEXT, Moves BLOB, PawnHome BLOB);
''')
N=200000
db.execute("INSERT INTO Events VALUES (1,'Rated Blitz game'),(2,'Rated Classical game')")
db.execute("INSERT INTO Sites VALUES (1,'https://lichess.org/abc')")
for i in range(1,5001): db.execute("INSERT INTO Players VALUES (?,?,?)",(i,f"Player{i:04d}",1000+i%1500))
db.execute("INSERT INTO Players VALUES (5001,'Magnus_Test',2850)")
rows=[]
for i in range(1,N+1):
    mv=games[i%len(games)]
    w=random.randint(1,5000); b=random.randint(1,5000)
    if i%977==0: w=5001
    rows.append((i,1+i%2,1,f"20{13+i%10}.0{1+i%9}.1{i%10}",None,'-',w,1000+w%1500,b,1000+b%1500,0,0,1+i%3,'300+0',"B%02d"%(i%100),len(mv),None,mv,b''))
    if len(rows)>=20000: db.executemany("INSERT INTO Games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",rows); rows=[]
db.executemany("INSERT INTO Games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",rows)
db.execute("INSERT INTO Info VALUES ('Title','teste'),('GameCount',?)",(str(N),))
db.commit(); db.close()
print(os.path.getsize('/tmp/ec-test.db3')/1e6,'MB')
