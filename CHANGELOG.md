# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- Added an Azure OpenAI configuration section to README with required fields and setup guidance.

## [1.0.9] - 2025-05-12

### Added
- Support for local LLMs via Ollama integration
- Ollama proxy for network-restricted environments
- Enhanced timeout settings (120s) for handling longer AI responses
- Streaming response handling for Ollama
- Improved period handling for DHIS2 analytics queries

### Fixed
- Resolved data fetching issues with relative periods
- Fixed missing response data in Ollama chat interface
- Enhanced error handling for API responses
- Better logging for debugging

### Changed
- Updated README with more accurate feature descriptions
- Improved organization of release files
- Enhanced project structure for better maintainability

## [1.0.8] - 2025-03-25

### Added
- Initial release
- DHIS2 data integration
- OpenAI API support
- Data visualization with Chart.js
- Data selection workflow
- HTML report export functionality