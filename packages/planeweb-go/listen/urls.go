// Package listen prints human-readable URLs for any HTTP(S) server bind address.
// Use this from dnslat, speedplane, or any app that embeds planeweb.
package listen

import (
	"fmt"
	"log"
	"net"
	"sort"
	"strings"
)

// LogURLs logs the bind address and every URL clients may use to reach the server.
// listenAddr is exactly what you pass to http.ListenAndServe / http.Server.Addr (e.g. ":8080", "127.0.0.1:9090", "0.0.0.0:80").
// scheme is "http" or "https".
// serviceName is printed in the log prefix (e.g. "dnslat", "speedplane"); may be empty.
func LogURLs(serviceName, scheme, listenAddr string) {
	LogURLsToLogger(serviceName, scheme, listenAddr, log.Default())
}

// Logger matches log.Logger.Printf (or *slog.Logger via adapter).
type Logger interface {
	Printf(format string, v ...any)
}

// LogURLsToLogger is like LogURLs but uses the given logger.
func LogURLsToLogger(serviceName, scheme, listenAddr string, lg Logger) {
	if lg == nil {
		lg = log.Default()
	}
	host, port, err := splitHostPort(listenAddr)
	if err != nil || port == "" {
		prefix := prefixLine(serviceName)
		lg.Printf("%scould not parse listen address %q: %v — still binding as configured", prefix, listenAddr, err)
		return
	}

	prefix := prefixLine(serviceName)
	lg.Printf("%sbound to %s", prefix, formatBindAddr(host, port))

	urls := urlsForBind(scheme, host, port)
	lg.Printf("%slistening — open in browser:", prefix)
	for _, u := range urls {
		lg.Printf("%s  %s", prefix, u)
	}
}

func prefixLine(name string) string {
	if name == "" {
		return ""
	}
	return "[" + name + "] "
}

func splitHostPort(addr string) (host, port string, err error) {
	host, port, err = net.SplitHostPort(addr)
	if err == nil {
		return host, port, nil
	}
	// ":8080" or "[::]:8080"
	if strings.HasPrefix(addr, ":") {
		return "", strings.TrimPrefix(addr, ":"), nil
	}
	if strings.HasPrefix(addr, "[") {
		return net.SplitHostPort(addr)
	}
	return "", "", err
}

func formatBindAddr(host, port string) string {
	if host == "" {
		return "all interfaces, port " + port
	}
	return net.JoinHostPort(host, port)
}

func isAllInterfaces(host string) bool {
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		return true
	default:
		return false
	}
}

func urlsForBind(scheme, host, port string) []string {
	if !isAllInterfaces(host) {
		return []string{joinURL(scheme, host, port)}
	}

	seen := make(map[string]struct{})
	var out []string
	add := func(u string) {
		if _, ok := seen[u]; ok {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}

	add(joinURL(scheme, "127.0.0.1", port))
	add(joinURL(scheme, "localhost", port))
	add(fmt.Sprintf("%s://[::1]:%s", scheme, port))

	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			ip := ipnet.IP
			if ip4 := ip.To4(); ip4 != nil {
				add(joinURL(scheme, ip4.String(), port))
				continue
			}
			// IPv6: include global, ULA, link-local (useful on LAN)
			if ip.IsGlobalUnicast() || ip.IsLinkLocalUnicast() || isUniqueLocal(ip) {
				add(fmt.Sprintf("%s://[%s]:%s", scheme, ip.String(), port))
			}
		}
	}

	sort.Strings(out)
	return out
}

func isUniqueLocal(ip net.IP) bool {
	// fc00::/7
	if len(ip) != net.IPv6len {
		return false
	}
	return ip[0] == 0xfd || ip[0] == 0xfc
}

func joinURL(scheme, host, port string) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return fmt.Sprintf("%s://[%s]:%s", scheme, host, port)
	}
	return fmt.Sprintf("%s://%s:%s", scheme, host, port)
}
