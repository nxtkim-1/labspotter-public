"""Real HTTP hosted/account ownership check, no encoder or Meta calls."""
import os,sys,unittest
sys.path.insert(0,os.path.dirname(__file__))
from test_hosted import T as Hosted
class ProjectsHTTP(Hosted):
 def test_everything(self):
  ca,_=self.signup('owner');cb,_=self.signup('other')
  self.assertEqual(self.req('GET','/api/bench/projects')[0],401)
  st,j,_=self.req('POST','/api/bench/session',{'name':'test'},cookie=ca);self.assertEqual(st,201);sid=j['session_id']
  st,j,_=self.req('POST','/api/bench/projects',{'action':'create_project','name':'Water observations'},cookie=ca);self.assertEqual(st,200);pid=j['projects'][0]['id']
  body={'action':'label_session','session_id':sid,'name':'Test observation','project':pid}
  self.assertEqual(self.req('POST','/api/bench/projects',body,cookie=ca)[0],200)
  self.assertEqual(self.req('GET','/api/bench/projects',cookie=ca)[1]['labels'][sid]['name'],'Test observation')
  self.assertEqual(self.req('GET','/api/bench/projects',cookie=cb)[1],{'projects':[],'labels':{}})
  self.assertEqual(self.req('POST','/api/bench/projects',body,cookie=cb)[0],404)
  self.assertEqual(self.req('POST','/api/bench/projects',{'action':'create_project','name':'Bad origin'},cookie=ca,origin='https://untrusted.invalid')[0],403)
if __name__=='__main__':unittest.main()
