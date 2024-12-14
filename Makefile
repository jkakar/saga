build:
	npm install

lint:
	tsc

test: lint
	npx vitest src
