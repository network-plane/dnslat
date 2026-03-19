# No npm: requires esbuild on PATH (https://esbuild.github.io/getting-started/#download-a-build)
ESBUILD ?= esbuild

.PHONY: dnslat-frontend speedplane-frontend dnslat speedplane

dnslat-frontend:
	mkdir -p cmd/dnslat/webdist
	$(ESBUILD) web/dnslat/src/main.ts --bundle --outfile=cmd/dnslat/webdist/main.js --sourcemap
	cp web/dnslat/src/index.html cmd/dnslat/webdist/

speedplane-frontend:
	$(MAKE) -C speedplane frontend

dnslat: dnslat-frontend
	go build -o dnslat ./cmd/dnslat

speedplane: speedplane-frontend
	$(MAKE) -C speedplane backend
