build:
	npm install
test: build
	npx vitest src
