# Get the latest git tag (fallback to v1.0.0 if no tags exist)
CURRENT_VERSION := $(shell git describe --tags --abbrev=0 2>/dev/null || echo "v1.0.0")

# Extract major, minor, and patch numbers
MAJOR := $(shell echo $(CURRENT_VERSION) | cut -d. -f1 | tr -d 'v')
MINOR := $(shell echo $(CURRENT_VERSION) | cut -d. -f2)
PATCH := $(shell echo $(CURRENT_VERSION) | cut -d. -f3)

# Increment patch version
NEW_VERSION := v$(MAJOR).$(MINOR).$(shell expr $(PATCH) + 1)

# Release target: Tag and push the new version
release:
	@echo "🔖 Current version: $(CURRENT_VERSION)"
	@echo "🚀 Releasing new version: $(NEW_VERSION)"
	@git tag $(NEW_VERSION)
	@git push origin $(NEW_VERSION)

build-windows:
	@wails build -platform windows/amd64 --clean

clean-go-temp:
	@go clean -modcache -cache -testcache