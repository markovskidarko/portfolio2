# PowerShell script to sync Stock Market portfolios
# This is an alternative to the batch file, using PowerShell directly

param(
    [string]$ServerUrl = $null
)

# Set error action preference
$ErrorActionPreference = "Continue"

$SERVER_URL = if ($ServerUrl) { $ServerUrl } elseif ($env:SERVER_URL) { $env:SERVER_URL } else { "http://localhost:3000" }

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Output "[$timestamp] Starting Stock Market sync..."
Write-Output "[$timestamp] Server URL: $SERVER_URL"
Write-Output "[$timestamp] Working Directory: $(Get-Location)"

# First, check if server is reachable
try {
    Write-Output "[$timestamp] Checking if server is running..."
    $testResponse = Invoke-WebRequest -Uri "$SERVER_URL/api/health" -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
    Write-Output "[$timestamp] Server is reachable (Status: $($testResponse.StatusCode))"
} catch {
    # Health endpoint might not exist, try the actual endpoint
    Write-Output "[$timestamp] Health check failed, trying sync endpoint directly..."
}

# Now try the actual sync
try {
    Write-Output "[$timestamp] Calling $SERVER_URL/api/sync..."
    $response = Invoke-WebRequest -Uri "$SERVER_URL/api/sync" -Method POST -ContentType "application/json" -UseBasicParsing -TimeoutSec 300
    
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Output "[$timestamp] Stock Market sync completed - Status: $($response.StatusCode)"
    
    if ($response.Content) {
        try {
            $result = $response.Content | ConvertFrom-Json
            if ($result.success) {
                Write-Output "[$timestamp] Success: $($result.message)"
            } else {
                Write-Output "[$timestamp] Error from server: $($result.error)"
                if ($result.details) {
                    Write-Output "[$timestamp] Details: $($result.details)"
                }
                exit 1
            }
        } catch {
            Write-Output "[$timestamp] Response received but couldn't parse JSON: $($response.Content)"
        }
    }
} catch {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $errorMsg = $_.Exception.Message
    Write-Output "[$timestamp] ERROR: $errorMsg"
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Output "[$timestamp] HTTP Status Code: $statusCode"
        
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Output "[$timestamp] Response Body: $responseBody"
        } catch {
            Write-Output "[$timestamp] Could not read error response"
        }
    }
    
    Write-Output "[$timestamp] Full Error Details:"
    Write-Output $_.Exception | Format-List -Force | Out-String
    
    exit 1
}

