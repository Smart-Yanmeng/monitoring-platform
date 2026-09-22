import { useState } from 'react'

type Alarm = { id: number; area: string; reason: string; time: string; device: string }

// 前端演示数据，后续替换为后端报警接口
const INITIAL_ALARMS: Alarm[] = [
  { id: 1, area: '校部 > 门禁', reason: '门磁开启', time: '2026-09-23 10:38:07', device: 'door2740 00A5D4' },
  { id: 2, area: '校部 > 门禁', reason: '门磁开启', time: '2026-09-23 09:59:05', device: 'door2740 00A5D4' },
  { id: 3, area: '第五社区 > 围墙', reason: '红外触发', time: '2026-09-23 09:12:41', device: 'ir3301 00B7C2' },
  { id: 4, area: '第五社区 > 机房', reason: '温度过高', time: '2026-09-23 08:55:19', device: 'sensor003 00C1A8' },
  { id: 5, area: '第五社区 > 机房', reason: '市电断电', time: '2026-09-23 08:41:02', device: 'sensor007 00D2F1' },
  { id: 6, area: '校部 > 机房', reason: '烟感报警', time: '2026-09-22 22:17:33', device: 'smoke012 00E4B9' },
  { id: 7, area: '第五社区 > 门禁', reason: '门磁开启', time: '2026-09-22 21:06:58', device: 'door2755 00F3C7' },
]

export default function AlarmManage() {
  const [alarms, setAlarms] = useState<Alarm[]>(INITIAL_ALARMS)

  const ignore = (id: number) => setAlarms((prev) => prev.filter((a) => a.id !== id))

  return (
    <div>
      <h2>报警管理</h2>
      <p className="detail">当前为前端演示数据，接入后端报警接口后展示实时报警。</p>

      <div className="card">
        <table className="menu-table">
          <thead>
            <tr>
              <th>报警区域</th>
              <th>报警原因</th>
              <th>报警时间</th>
              <th>设备名称</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {alarms.map((a) => (
              <tr key={a.id}>
                <td>{a.area}</td>
                <td>{a.reason}</td>
                <td>{a.time}</td>
                <td>{a.device}</td>
                <td>
                  <button onClick={() => ignore(a.id)}>忽略</button>
                </td>
              </tr>
            ))}
            {alarms.length === 0 && (
              <tr>
                <td colSpan={5}>暂无报警</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
