import { useState } from 'react'

type DeletedUser = { id: number; username: string; deletedAt: string }
type DeletedDevice = { id: number; name: string; deviceId: string; deletedAt: string }

// 前端演示数据，后续替换为后端回收站接口
const INITIAL_USERS: DeletedUser[] = [
  { id: 1, username: 'zhangsan', deletedAt: '2026-09-20 14:22:10' },
  { id: 2, username: 'lisi', deletedAt: '2026-09-19 09:41:37' },
  { id: 3, username: 'wangwu', deletedAt: '2026-09-15 16:05:02' },
]

const INITIAL_DEVICES: DeletedDevice[] = [
  { id: 1, name: '306网络摄像机', deviceId: 'cam0306 00A1B2', deletedAt: '2026-09-21 11:30:44' },
  { id: 2, name: '门禁主机 door2740', deviceId: 'door2740 00A5D4', deletedAt: '2026-09-18 10:12:19' },
  { id: 3, name: '温湿度传感器 sensor003', deviceId: 'sensor003 00C1A8', deletedAt: '2026-09-12 08:47:55' },
]

export default function RecycleManage() {
  const [tab, setTab] = useState<'user' | 'device'>('user')
  const [users, setUsers] = useState<DeletedUser[]>(INITIAL_USERS)
  const [devices, setDevices] = useState<DeletedDevice[]>(INITIAL_DEVICES)

  // 演示：恢复/彻底删除均从回收站列表移除
  const removeUser = (id: number) => setUsers((prev) => prev.filter((u) => u.id !== id))
  const removeDevice = (id: number) => setDevices((prev) => prev.filter((d) => d.id !== id))

  return (
    <div>
      <h2>回收站管理</h2>
      <p className="detail">已删除的人员与设备在此保留，可恢复或彻底删除（当前为前端演示数据）。</p>

      <div className="seg">
        <button
          className={tab === 'user' ? 'active' : ''}
          onClick={() => setTab('user')}
        >
          人员回收站
        </button>
        <button
          className={tab === 'device' ? 'active' : ''}
          onClick={() => setTab('device')}
        >
          设备回收站
        </button>
      </div>

      {tab === 'user' ? (
        <div className="card">
          <table className="menu-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>删除时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.deletedAt}</td>
                  <td>
                    <button onClick={() => removeUser(u.id)}>恢复</button>
                    <button className="danger" onClick={() => removeUser(u.id)}>
                      彻底删除
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3}>回收站为空</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <table className="menu-table">
            <thead>
              <tr>
                <th>设备名称</th>
                <th>设备 ID</th>
                <th>删除时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.deviceId}</td>
                  <td>{d.deletedAt}</td>
                  <td>
                    <button onClick={() => removeDevice(d.id)}>恢复</button>
                    <button className="danger" onClick={() => removeDevice(d.id)}>
                      彻底删除
                    </button>
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td colSpan={4}>回收站为空</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
