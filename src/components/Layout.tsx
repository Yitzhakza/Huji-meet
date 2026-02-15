import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut, Upload, LayoutDashboard, Settings } from 'lucide-react';

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <Link to="/" className="logo">Huji Meet</Link>
          <nav className="nav-links">
            <Link to="/"><LayoutDashboard size={18} /> Dashboard</Link>
            <Link to="/upload"><Upload size={18} /> Upload</Link>
            {profile?.is_admin && (
              <Link to="/admin"><Settings size={18} /> Admin</Link>
            )}
          </nav>
        </div>
        <div className="header-right">
          <span className="user-email">{user?.email}</span>
          <button onClick={handleSignOut} className="btn btn-ghost" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
