package config

import (
	"net"
	"strconv"
	"strings"
)

// TCPListenAddress returns an address for net.Listen("tcp", addr).
// If useCLIFlags is true, listenHost and listenPort come from CLI (--listen / --listen-port).
// Otherwise, if listenFromFile is set (e.g. ":8989"), it wins; else cobra defaults apply.
func TCPListenAddress(useCLIFlags bool, listenHost string, listenPort int, listenFromFile string) string {
	if useCLIFlags {
		if listenHost != "" && listenHost != "all" {
			return net.JoinHostPort(listenHost, strconv.Itoa(listenPort))
		}
		return ":" + strconv.Itoa(listenPort)
	}
	s := strings.TrimSpace(listenFromFile)
	if s != "" {
		return normalizeListenAddr(s)
	}
	if listenHost != "" && listenHost != "all" {
		return net.JoinHostPort(listenHost, strconv.Itoa(listenPort))
	}
	return ":" + strconv.Itoa(listenPort)
}

func normalizeListenAddr(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, ":") {
		return s
	}
	host, port, err := net.SplitHostPort(s)
	if err == nil {
		if host == "" {
			return ":" + port
		}
		return net.JoinHostPort(host, port)
	}
	if _, err := strconv.Atoi(s); err == nil {
		return ":" + s
	}
	return s
}
