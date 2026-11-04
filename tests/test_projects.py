import os,sys,tempfile,unittest
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
import bench_session as B
class Projects(unittest.TestCase):
 def test_owner_scoped_labels_and_projects(self):
  with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
   sid=B.create_session(a,'first')['session_id'];B.add_note(a,sid,'observation','Possible cloudiness, not confirmed.')
   p=B.organization(a,{'action':'create_project','name':'Water observations'})['projects'][0]['id']
   o=B.organization(a,{'action':'label_session','session_id':sid,'name':'Morning sample','project':p})
   self.assertEqual(o['labels'][sid]['name'],'Morning sample');self.assertEqual(B.organization(b),{'projects':[],'labels':{}})
   self.assertEqual(B.organization(a)['labels'][sid]['project'],p)
   self.assertEqual(len(B.session_info(a,sid)['checkpoints']),1)
   self.assertEqual(B.continue_session(a,sid)['record_intact'],True)
   with self.assertRaises(B.BenchError):B.organization(b,{'action':'label_session','session_id':sid,'name':'stolen','project':''})
 def test_validation(self):
  with tempfile.TemporaryDirectory() as a:
   with self.assertRaises(B.BenchError):B.organization(a,{'action':'create_project','name':' '})
   sid=B.create_session(a,'first')['session_id']
   with self.assertRaises(B.BenchError):B.organization(a,{'action':'label_session','session_id':sid,'name':'test','project':'doesnotexist'})
if __name__=='__main__':unittest.main()
