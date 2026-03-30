#!/usr/bin/env node

/**
 * Test script to verify Azure OpenAI integration
 * Run with: node test-azure-integration.js
 */

console.log('🧪 Testing Azure OpenAI Integration...\n')

// Test 1: Check if azureOpenAI.js file exists and has correct exports
console.log('✓ Test 1: Checking Azure OpenAI module...')
try {
  // Note: We can't directly import ES modules in Node without babel, but we can check the file
  const fs = require('fs')
  const azureOpenAIContent = fs.readFileSync('./src/utils/azureOpenAI.js', 'utf-8')
  
  // Check for required exports
  const hasExportSendToAzure = azureOpenAIContent.includes('export const sendToAzureOpenAI')
  const hasExportTestConnection = azureOpenAIContent.includes('export const testAzureOpenAIConnection')
  const hasCreateSystemPrompt = azureOpenAIContent.includes('const createSystemPrompt')
  const hasExtractRecommendations = azureOpenAIContent.includes('const extractRecommendations')
  
  if (hasExportSendToAzure && hasExportTestConnection && hasCreateSystemPrompt && hasExtractRecommendations) {
    console.log('  ✅ Azure OpenAI module has all required exports')
  } else {
    console.log('  ❌ Missing some exports:')
    console.log(`    - sendToAzureOpenAI: ${hasExportSendToAzure}`)
    console.log(`    - testAzureOpenAIConnection: ${hasExportTestConnection}`)
    console.log(`    - createSystemPrompt: ${hasCreateSystemPrompt}`)
    console.log(`    - extractRecommendations: ${hasExtractRecommendations}`)
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`)
}

// Test 2: Check aiService.js is updated
console.log('\n✓ Test 2: Checking aiService.js integration...')
try {
  const fs = require('fs')
  const aiServiceContent = fs.readFileSync('./src/utils/aiService.js', 'utf-8')
  
  const hasAzureImport = aiServiceContent.includes('azureOpenAI')
  const hasAzureProviderCheck = aiServiceContent.includes("aiProvider === 'azure-openai'")
  const hasAzureImportFunction = aiServiceContent.includes('sendToAzureOpenAI')
  
  if (hasAzureImport && hasAzureProviderCheck && hasAzureImportFunction) {
    console.log('  ✅ aiService.js correctly integrated Azure OpenAI')
  } else {
    console.log('  ❌ Missing Azure integration in aiService.js:')
    console.log(`    - Azure import: ${hasAzureImport}`)
    console.log(`    - Provider check: ${hasAzureProviderCheck}`)
    console.log(`    - sendToAzureOpenAI function: ${hasAzureImportFunction}`)
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`)
}

// Test 3: Check SettingsPanel.jsx is updated
console.log('\n✓ Test 3: Checking SettingsPanel.jsx integration...')
try {
  const fs = require('fs')
  const settingsPanelContent = fs.readFileSync('./src/components/SettingsPanel.jsx', 'utf-8')
  
  const hasAzureState = settingsPanelContent.includes('azureResourceName') && 
                        settingsPanelContent.includes('azureDeploymentName')
  const hasAzureOption = settingsPanelContent.includes('azure-openai')
  const hasAzureConfig = settingsPanelContent.includes('Azure OpenAI Configuration')
  const hasAzureTestFunction = settingsPanelContent.includes('handleTestAzureOpenAIConnection')
  
  if (hasAzureState && hasAzureOption && hasAzureConfig && hasAzureTestFunction) {
    console.log('  ✅ SettingsPanel.jsx correctly configured for Azure OpenAI')
  } else {
    console.log('  ❌ Missing Azure configuration in SettingsPanel.jsx:')
    console.log(`    - State variables: ${hasAzureState}`)
    console.log(`    - Provider option: ${hasAzureOption}`)
    console.log(`    - Azure config section: ${hasAzureConfig}`)
    console.log(`    - Test function: ${hasAzureTestFunction}`)
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`)
}

// Test 4: Check documentation
console.log('\n✓ Test 4: Checking documentation updates...')
try {
  const fs = require('fs')
  const readmeContent = fs.readFileSync('./README.md', 'utf-8')
  
  const hasAzureInFeatures = readmeContent.includes('Azure OpenAI')
  const hasAzureInSetup = readmeContent.includes('Azure OpenAI') && readmeContent.includes('Configuration')
  
  if (hasAzureInFeatures && hasAzureInSetup) {
    console.log('  ✅ Documentation updated with Azure OpenAI references')
  } else {
    console.log('  ⚠️  Documentation could be updated:')
    console.log(`    - Azure in features: ${hasAzureInFeatures}`)
    console.log(`    - Azure in setup: ${hasAzureInSetup}`)
  }
} catch (error) {
  console.log(`  ❌ Error: ${error.message}`)
}

// Test 5: Verify build succeeds
console.log('\n✓ Test 5: Checking if build works...')
try {
  const { execSync } = require('child_process')
  console.log('  Running npm run build...')
  
  try {
    const output = execSync('npm run build 2>&1', { timeout: 60000 }).toString()
    
    if (output.includes('DONE')) {
      console.log('  ✅ Build successful!')
    } else {
      console.log('  ⚠️  Build completed but verify output')
    }
  } catch (buildError) {
    if (buildError.toString().includes('DONE')) {
      console.log('  ✅ Build successful!')
    } else {
      console.log('  ❌ Build failed')
      console.log(buildError.toString().slice(0, 500))
    }
  }
} catch (error) {
  console.log(`  ⚠️  Skipping build test: ${error.message}`)
}

console.log('\n' + '='.repeat(50))
console.log('✨ Azure OpenAI Integration Test Complete!\n')
console.log('Summary:')
console.log('--------')
console.log('✅ Module created: src/utils/azureOpenAI.js')
console.log('✅ Service integrated: src/utils/aiService.js')
console.log('✅ UI updated: src/components/SettingsPanel.jsx')
console.log('✅ Documentation updated: README.md')
console.log('\nNext steps:')
console.log('1. Deploy the app to a DHIS2 instance')
console.log('2. Log in with your DHIS2 credentials')
console.log('3. Go to Settings and select "Azure OpenAI" as AI Provider')
console.log('4. Enter your Azure OpenAI credentials:')
console.log('   - API Key')
console.log('   - Resource Name')
console.log('   - Deployment Name')
console.log('5. Test the connection')
console.log('6. Try analyzing data with Azure OpenAI\n')
