# No npm: requires esbuild on PATH (https://esbuild.github.io/getting-started/#download-a-build)
ESBUILD ?= esbuild

.PHONY: dnslat-frontend speedplane-frontend dnslat dnslat-linux linux speedplane

dnslat-frontend:
	mkdir -p cmd/dnslat/webdist
	$(ESBUILD) web/dnslat/src/main.ts --bundle --outfile=cmd/dnslat/webdist/main.js --sourcemap
	cp web/dnslat/src/index.html cmd/dnslat/webdist/

speedplane-frontend:
	$(MAKE) -C speedplane frontend

dnslat: dnslat-frontend
	go build -o dnslat ./cmd/dnslat

# Cross-compile for Linux x86_64 (e.g. deploy binary to servers).
dnslat-linux: dnslat-frontend
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o dnslat-linux-amd64 ./cmd/dnslat

linux: dnslat-linux

speedplane: speedplane-frontend
	$(MAKE) -C speedplane backend
