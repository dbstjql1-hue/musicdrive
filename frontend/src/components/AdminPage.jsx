import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Shield, ShieldAlert, Trash2, ArrowLeft } from 'lucide-react';
import './AdminPage.css';

export default function AdminPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate('/');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      alert('관리자 권한이 없습니다.');
      navigate('/');
      return;
    }

    setCurrentUserProfile(profile);
    fetchUsers();
  }

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching users:', error);
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  }

  async function toggleRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      alert('권한 변경 실패: ' + error.message);
    } else {
      fetchUsers();
    }
  }

  async function deleteUser(userId) {
    if (!window.confirm('정말로 이 회원을 강제 탈퇴시키겠습니까?')) return;
    
    // 백엔드 API를 호출하여 auth.users에서 삭제해야 합니다.
    // 현재는 profiles 테이블에서만 삭제를 시도합니다. (CASCADE 설정에 따라 백엔드 연동 전 임시)
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      alert('회원 삭제 실패: ' + error.message);
    } else {
      fetchUsers();
    }
  }

  if (loading) {
    return <div className="admin-loading">로딩 중...</div>;
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={20} /> 메인으로
        </button>
        <h2>사용자 관리 (어드민)</h2>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>가입일</th>
              <th>권한</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <span className={`role-badge ${user.role}`}>
                    {user.role === 'admin' ? '관리자' : '일반'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button 
                      className={`role-btn ${user.role === 'admin' ? 'revoke' : 'grant'}`}
                      onClick={() => toggleRole(user.id, user.role)}
                      disabled={user.id === currentUserProfile.id}
                    >
                      {user.role === 'admin' ? <ShieldAlert size={16} /> : <Shield size={16} />}
                      {user.role === 'admin' ? '권한 해제' : '관리자 임명'}
                    </button>
                    <button 
                      className="delete-btn"
                      onClick={() => deleteUser(user.id)}
                      disabled={user.id === currentUserProfile.id}
                    >
                      <Trash2 size={16} /> 삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
