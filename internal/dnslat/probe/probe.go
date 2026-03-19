package probe

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/miekg/dns"
)

func ensureAddr(addr string) string {
	if strings.Contains(addr, ":") {
		host, _, err := net.SplitHostPort(addr)
		if err == nil && host != "" {
			return addr
		}
	}
	return net.JoinHostPort(strings.TrimSpace(addr), "53")
}

// Lookup measures round-trip DNS resolution time.
func Lookup(ctx context.Context, server, domain string) (latencyMs float64, rcode int, answerCount int, ttlMin int, err error) {
	if domain == "" {
		domain = "example.com"
	}
	domain = dns.Fqdn(domain)
	c := &dns.Client{Net: "udp", Timeout: 5 * time.Second}
	m := new(dns.Msg)
	m.SetQuestion(domain, dns.TypeA)
	m.RecursionDesired = true
	addr := ensureAddr(server)
	start := time.Now()
	r, _, e := c.ExchangeContext(ctx, m, addr)
	latencyMs = float64(time.Since(start).Microseconds()) / 1000.0
	if e != nil {
		return latencyMs, 0, 0, 0, e
	}
	rcode = r.Rcode
	answerCount = len(r.Answer)
	ttlMin = 0
	for _, a := range r.Answer {
		h := a.Header()
		if ttlMin == 0 || int(h.Ttl) < ttlMin {
			ttlMin = int(h.Ttl)
		}
	}
	return latencyMs, rcode, answerCount, ttlMin, nil
}

func RcodeString(rcode int) string {
	return fmt.Sprintf("%s (%d)", dns.RcodeToString[rcode], rcode)
}
