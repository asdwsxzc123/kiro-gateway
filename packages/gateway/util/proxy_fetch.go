package util

import (
	"net"
	"net/http"
	"net/url"
	"time"
)

const defaultHTTPTimeout = 30 * time.Second

// NewHTTPClient creates an *http.Client with the given timeout. If proxyURL is
// non-empty it is parsed and used as the transport proxy (supports http, https,
// and socks5 schemes). An empty proxyURL produces a client without a proxy.
func NewHTTPClient(proxyURL string, timeout time.Duration) *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	if proxyURL != "" {
		parsed, err := url.Parse(proxyURL)
		if err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}
}

// DefaultHTTPClient returns an *http.Client with a 30-second timeout and no
// proxy configured.
func DefaultHTTPClient() *http.Client {
	return NewHTTPClient("", defaultHTTPTimeout)
}
