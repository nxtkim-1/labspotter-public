import os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import auth
class T(unittest.TestCase):
    def setUp(self): self.r = tempfile.mkdtemp()
    def test_signup_login_session_logout(self):
        tok, uid = auth.signup(self.r, "thomas", "correct horse battery")
        self.assertEqual(auth.whoami(self.r, tok)["name"], "thomas")
        auth.logout(self.r, tok); self.assertIsNone(auth.whoami(self.r, tok))
        tok2, uid2 = auth.login(self.r, "THOMAS", "correct horse battery"); self.assertEqual(uid, uid2)
    def test_bad_inputs(self):
        with self.assertRaises(ValueError): auth.signup(self.r, "a", "correct horse battery")
        with self.assertRaises(ValueError): auth.signup(self.r, "okname", "short")
        auth.signup(self.r, "okname", "correct horse battery")
        with self.assertRaises(ValueError): auth.signup(self.r, "okname", "another long password")
        with self.assertRaises(PermissionError): auth.login(self.r, "okname", "wrong password here")
        with self.assertRaises(PermissionError): auth.login(self.r, "nobody", "wrong password here")
    def test_invite_and_throttle(self):
        with self.assertRaises(PermissionError): auth.signup(self.r, "okname", "correct horse battery", "no", required_invite="yes")
        auth.signup(self.r, "okname", "correct horse battery", "yes", required_invite="yes")
        for _ in range(8):
            with self.assertRaises(PermissionError): auth.login(self.r, "okname", "bad bad bad bad", ip="1.2.3.4")
        with self.assertRaises(PermissionError) as c: auth.login(self.r, "okname", "correct horse battery", ip="1.2.3.4")
        self.assertIn("too many", str(c.exception))
    def test_password_change_and_delete(self):
        tok, uid = auth.signup(self.r, "okname", "correct horse battery")
        auth.user_dir(self.r, uid)
        with self.assertRaises(PermissionError): auth.change_password(self.r, uid, "nope nope nope", "new long password")
        auth.change_password(self.r, uid, "correct horse battery", "new long password")
        self.assertIsNone(auth.whoami(self.r, tok))
        auth.login(self.r, "okname", "new long password")
        auth.delete_account(self.r, uid, "new long password")
        self.assertFalse(os.path.exists(os.path.join(self.r, "users", uid)))
        with self.assertRaises(PermissionError): auth.login(self.r, "okname", "new long password")
if __name__ == "__main__": unittest.main()
