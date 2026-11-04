"""Actual hosted HTTP gates with MOCK Meta upstream, never a real call."""
import http.client, io, json, os, socket, subprocess, sys, tempfile, time, unittest, wave
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class HostedVoice(unittest.TestCase):
 def test_http(self):
  with tempfile.TemporaryDirectory() as d:
   open(os.path.join(d,'_voice_allowance.jsonl'),'w').close()
   s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
   code="import sys; sys.argv=['server.py','--port',sys.argv[1]]; import voice_gate; voice_gate.upstream=lambda w,s:(200,{'transcript':'The liquid is clear','seconds':s}); exec(compile(open('server.py').read(),'server.py','exec'),{'__name__':'__main__','__file__':'server.py'})"
   env=dict(os.environ,LABSPOTTER_HOSTED='1',LABSPOTTER_RUNS=d,LABSPOTTER_INVITE_CODE='testinvite',LABSPOTTER_VOICE_CLEARED='1',MODEL_API_KEY='MOCK_NOT_REAL')
   p=subprocess.Popen([sys.executable,'-c',code,str(port)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=None)
   try:
    for _ in range(60):
     try: socket.create_connection(('127.0.0.1',port),.1).close();break
     except OSError: time.sleep(.1)
    def req(path,body,cookie='',origin='ok'):
     h=http.client.HTTPConnection('127.0.0.1',port,timeout=10);hd={'Content-Type':'audio/wav'}
     if cookie:hd['Cookie']=cookie
     if origin:hd['Origin']=f'http://127.0.0.1:{port}' if origin=='ok' else origin
     h.request('POST',path,body,hd);r=h.getresponse();data=r.read();return r.status,data,r.getheader('Set-Cookie')
    b=io.BytesIO()
    with wave.open(b,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(bytes(32000))
    wav=b.getvalue()
    self.assertEqual(req('/api/voice/transcribe',wav)[0],401)
    signup=json.dumps({'username':'voice_user','password':'correct horse battery','invite':'testinvite'}).encode()
    st,_,cookie=req('/api/auth/signup',signup);self.assertEqual(st,201);cookie=cookie.split(';')[0]
    for origin in ('','https://evil.example'):
     self.assertEqual(req('/api/voice/transcribe',wav,cookie,origin)[0],403)
    self.assertEqual(req('/api/voice/transcribe',b'bad',cookie)[0],400)
    for _ in range(5):self.assertEqual(req('/api/voice/transcribe',wav,cookie)[0],200)
    self.assertEqual(req('/api/voice/transcribe',wav,cookie)[0],429)
    self.assertEqual(len(open(os.path.join(d,'_voice_allowance.jsonl')).readlines()),5)
    self.assertEqual(req('/api/agent/glimpse',wav,cookie)[0],403)
   finally:p.terminate();p.wait()
if __name__=='__main__':unittest.main()
