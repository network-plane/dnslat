package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

type connWithMutex struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// Manager manages WebSocket connections for broadcasting to planeweb UIs.
type Manager struct {
	mu          sync.RWMutex
	connections map[*websocket.Conn]*connWithMutex
}

func NewManager() *Manager {
	return &Manager{
		connections: make(map[*websocket.Conn]*connWithMutex),
	}
}

func (m *Manager) Add(conn *websocket.Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connections[conn] = &connWithMutex{conn: conn}
}

func (m *Manager) Remove(conn *websocket.Conn) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.connections, conn)
}

func (m *Manager) Broadcast(message map[string]interface{}) {
	m.mu.RLock()
	conns := make([]*connWithMutex, 0, len(m.connections))
	for _, cwm := range m.connections {
		conns = append(conns, cwm)
	}
	m.mu.RUnlock()

	for _, cwm := range conns {
		cwm.mu.Lock()
		err := cwm.conn.WriteJSON(message)
		cwm.mu.Unlock()
		if err != nil {
			m.Remove(cwm.conn)
		}
	}
}

func (m *Manager) WriteJSON(conn *websocket.Conn, message interface{}) error {
	m.mu.RLock()
	cwm, exists := m.connections[conn]
	m.mu.RUnlock()
	if !exists {
		return conn.WriteJSON(message)
	}
	cwm.mu.Lock()
	defer cwm.mu.Unlock()
	return cwm.conn.WriteJSON(message)
}
