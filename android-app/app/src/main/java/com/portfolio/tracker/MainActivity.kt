package com.portfolio.tracker

import android.content.SharedPreferences
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.portfolio.tracker.databinding.ActivityMainBinding
import okhttp3.*
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences
    private var eventSource: EventSource? = null
    private val gson = Gson()
    private val currencyFormatter = NumberFormat.getCurrencyInstance(Locale.US)
    private val percentFormatter = NumberFormat.getPercentInstance(Locale.US).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = getSharedPreferences("portfolio_prefs", MODE_PRIVATE)
        
        // Load saved settings or use defaults
        val serverIp = prefs.getString("server_ip", "") ?: ""
        val serverPort = prefs.getString("server_port", "3000") ?: "3000"
        
        if (serverIp.isEmpty()) {
            // Show settings if not configured
            openSettings()
        } else {
            connectToStream(serverIp, serverPort)
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.menu_settings -> {
                openSettings()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun openSettings() {
        val intent = android.content.Intent(this, SettingsActivity::class.java)
        startActivity(intent)
    }

    private fun connectToStream(serverIp: String, serverPort: String) {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                val url = "http://$serverIp:$serverPort/api/ws/all-metrics"
                
                val client = OkHttpClient.Builder()
                    .readTimeout(0, java.util.concurrent.TimeUnit.SECONDS) // No timeout for SSE
                    .build()

                val request = Request.Builder()
                    .url(url)
                    .header("Accept", "text/event-stream")
                    .header("Cache-Control", "no-cache")
                    .build()

                val eventSourceListener = object : EventSourceListener() {
                    override fun onOpen(eventSource: EventSource, response: Response) {
                        runOnUiThread {
                            updateConnectionStatus(true, "Connected")
                        }
                    }

                    override fun onEvent(
                        eventSource: EventSource,
                        id: String?,
                        type: String?,
                        data: String
                    ) {
                        try {
                            val json = gson.fromJson(data, JsonObject::class.java)
                            val messageType = json.get("type")?.asString
                            
                            if (messageType == "metrics") {
                                val metricsJson = json.getAsJsonObject("data")
                                val metrics = parseMetrics(metricsJson)
                                
                                runOnUiThread {
                                    updateUI(metrics)
                                }
                            } else if (messageType == "connected") {
                                runOnUiThread {
                                    updateConnectionStatus(true, "Connected")
                                }
                            } else if (messageType == "error") {
                                val errorMsg = json.get("message")?.asString ?: "Unknown error"
                                runOnUiThread {
                                    updateConnectionStatus(false, "Error: $errorMsg")
                                }
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                            runOnUiThread {
                                updateConnectionStatus(false, "Parse error: ${e.message}")
                            }
                        }
                    }

                    override fun onFailure(
                        eventSource: EventSource,
                        t: Throwable?,
                        response: Response?
                    ) {
                        runOnUiThread {
                            updateConnectionStatus(false, "Connection error: ${t?.message}")
                        }
                        
                        // Reconnect after 3 seconds
                        lifecycleScope.launch {
                            kotlinx.coroutines.delay(3000)
                            val ip = prefs.getString("server_ip", "") ?: ""
                            val port = prefs.getString("server_port", "3000") ?: "3000"
                            if (ip.isNotEmpty()) {
                                connectToStream(ip, port)
                            }
                        }
                    }
                }

                eventSource = EventSources.createFactory(client)
                    .newEventSource(request, eventSourceListener)
            }
        }
    }

    private fun parseMetrics(json: JsonObject): Metrics {
        return Metrics(
            totalWealth = json.get("totalWealth")?.asDouble ?: 0.0,
            totalWealthYTD = json.get("totalWealthYTD")?.asDouble ?: 0.0,
            totalWealthYTDPercent = json.get("totalWealthYTDPercent")?.asDouble ?: 0.0,
            totalWealthToday = json.get("totalWealthToday")?.asDouble ?: 0.0,
            totalWealthTodayPercent = json.get("totalWealthTodayPercent")?.asDouble ?: 0.0,
            stockMarketTotal = json.get("stockMarketTotal")?.asDouble ?: 0.0,
            stockMarketYTD = json.get("stockMarketYTD")?.asDouble ?: 0.0,
            stockMarketYTDPercent = json.get("stockMarketYTDPercent")?.asDouble ?: 0.0,
            stockMarketToday = json.get("stockMarketToday")?.asDouble ?: 0.0,
            stockMarketTodayPercent = json.get("stockMarketTodayPercent")?.asDouble ?: 0.0,
            kbFundsCurrentValue = json.get("kbFundsCurrentValue")?.asDouble ?: 0.0,
            kbFundsYTD = json.get("kbFundsYTD")?.asDouble ?: 0.0,
            kbFundsYTDPercent = json.get("kbFundsYTDPercent")?.asDouble ?: 0.0,
            kbFundsToday = json.get("kbFundsToday")?.asDouble ?: 0.0,
            kbFundsTodayPercent = json.get("kbFundsTodayPercent")?.asDouble ?: 0.0,
            stockPortfolios = json.getAsJsonArray("stockPortfolios")?.map { portfolioJson ->
                val portfolio = portfolioJson.asJsonObject
                StockPortfolio(
                    accountId = portfolio.get("accountId")?.asString ?: "",
                    accountAlias = portfolio.get("accountAlias")?.asString ?: "",
                    currentValue = portfolio.get("currentValue")?.asDouble ?: 0.0,
                    todayChange = portfolio.get("todayChange")?.asDouble ?: 0.0,
                    todayChangePercent = portfolio.get("todayChangePercent")?.asDouble ?: 0.0,
                    ytdChange = portfolio.get("ytdChange")?.asDouble ?: 0.0,
                    ytdChangePercent = portfolio.get("ytdChangePercent")?.asDouble ?: 0.0
                )
            } ?: emptyList(),
            timestamp = json.get("timestamp")?.asString ?: ""
        )
    }

    private fun updateConnectionStatus(connected: Boolean, message: String) {
        binding.statusIndicator.setBackgroundColor(
            if (connected) getColor(android.R.color.holo_green_dark)
            else getColor(android.R.color.holo_red_dark)
        )
        binding.statusText.text = message
    }

    private fun updateUI(metrics: Metrics) {
        // Total Wealth
        binding.totalWealthValue.text = currencyFormatter.format(metrics.totalWealth)
        binding.totalWealthYtdValue.text = formatChange(metrics.totalWealthYTD, metrics.totalWealthYTDPercent)
        binding.totalWealthTodayValue.text = formatChange(metrics.totalWealthToday, metrics.totalWealthTodayPercent)
        setTextColor(binding.totalWealthYtdValue, metrics.totalWealthYTD >= 0)
        setTextColor(binding.totalWealthTodayValue, metrics.totalWealthToday >= 0)

        // Stock Market
        binding.stockMarketValue.text = currencyFormatter.format(metrics.stockMarketTotal)
        binding.stockMarketYtdValue.text = formatChange(metrics.stockMarketYTD, metrics.stockMarketYTDPercent)
        binding.stockMarketTodayValue.text = formatChange(metrics.stockMarketToday, metrics.stockMarketTodayPercent)
        setTextColor(binding.stockMarketYtdValue, metrics.stockMarketYTD >= 0)
        setTextColor(binding.stockMarketTodayValue, metrics.stockMarketToday >= 0)

        // KB Funds
        binding.kbFundsValue.text = currencyFormatter.format(metrics.kbFundsCurrentValue)
        binding.kbFundsYtdValue.text = formatChange(metrics.kbFundsYTD, metrics.kbFundsYTDPercent)
        binding.kbFundsTodayValue.text = formatChange(metrics.kbFundsToday, metrics.kbFundsTodayPercent)
        setTextColor(binding.kbFundsYtdValue, metrics.kbFundsYTD >= 0)
        setTextColor(binding.kbFundsTodayValue, metrics.kbFundsToday >= 0)

        // Stock Portfolios
        binding.portfoliosList.removeAllViews()
        metrics.stockPortfolios.forEach { portfolio ->
            val portfolioView = layoutInflater.inflate(R.layout.item_portfolio, binding.portfoliosList, false)
            val accountName = portfolioView.findViewById<android.widget.TextView>(R.id.accountName)
            val accountId = portfolioView.findViewById<android.widget.TextView>(R.id.accountId)
            val currentValue = portfolioView.findViewById<android.widget.TextView>(R.id.currentValue)
            val ytdValue = portfolioView.findViewById<android.widget.TextView>(R.id.ytdValue)
            val todayValue = portfolioView.findViewById<android.widget.TextView>(R.id.todayValue)
            
            accountName.text = portfolio.accountAlias
            accountId.text = portfolio.accountId
            currentValue.text = currencyFormatter.format(portfolio.currentValue)
            ytdValue.text = formatChange(portfolio.ytdChange, portfolio.ytdChangePercent)
            todayValue.text = formatChange(portfolio.todayChange, portfolio.todayChangePercent)
            
            setTextColor(ytdValue, portfolio.ytdChange >= 0)
            setTextColor(todayValue, portfolio.todayChange >= 0)
            
            portfolioBinding.accountName.text = portfolio.accountAlias
            portfolioBinding.accountId.text = portfolio.accountId
            portfolioBinding.currentValue.text = currencyFormatter.format(portfolio.currentValue)
            portfolioBinding.ytdValue.text = formatChange(portfolio.ytdChange, portfolio.ytdChangePercent)
            portfolioBinding.todayValue.text = formatChange(portfolio.todayChange, portfolio.todayChangePercent)
            
            setTextColor(portfolioBinding.ytdValue, portfolio.ytdChange >= 0)
            setTextColor(portfolioBinding.todayValue, portfolio.todayChange >= 0)
            
            binding.portfoliosList.addView(portfolioView)
        }

        // Timestamp
        if (metrics.timestamp.isNotEmpty()) {
            try {
                val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                val date = dateFormat.parse(metrics.timestamp)
                val displayFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                binding.lastUpdateText.text = "Last update: ${displayFormat.format(date)}"
            } catch (e: Exception) {
                binding.lastUpdateText.text = "Last update: ${metrics.timestamp}"
            }
        }

        // Show content, hide loading
        binding.contentLayout.visibility = View.VISIBLE
        binding.loadingLayout.visibility = View.GONE
    }

    private fun formatChange(value: Double, percent: Double): String {
        val sign = if (value >= 0) "+" else ""
        return "$sign${currencyFormatter.format(Math.abs(value))} (${percentFormatter.format(percent / 100)})"
    }

    private fun setTextColor(textView: android.widget.TextView, isPositive: Boolean) {
        val color = if (isPositive) {
            getColor(android.R.color.holo_green_dark)
        } else {
            getColor(android.R.color.holo_red_dark)
        }
        textView.setTextColor(color)
    }

    override fun onDestroy() {
        super.onDestroy()
        eventSource?.cancel()
    }

    override fun onResume() {
        super.onResume()
        // Reconnect if settings changed
        val serverIp = prefs.getString("server_ip", "") ?: ""
        val serverPort = prefs.getString("server_port", "3000") ?: "3000"
        if (serverIp.isNotEmpty() && eventSource == null) {
            connectToStream(serverIp, serverPort)
        }
    }
}

data class Metrics(
    val totalWealth: Double,
    val totalWealthYTD: Double,
    val totalWealthYTDPercent: Double,
    val totalWealthToday: Double,
    val totalWealthTodayPercent: Double,
    val stockMarketTotal: Double,
    val stockMarketYTD: Double,
    val stockMarketYTDPercent: Double,
    val stockMarketToday: Double,
    val stockMarketTodayPercent: Double,
    val kbFundsCurrentValue: Double,
    val kbFundsYTD: Double,
    val kbFundsYTDPercent: Double,
    val kbFundsToday: Double,
    val kbFundsTodayPercent: Double,
    val stockPortfolios: List<StockPortfolio>,
    val timestamp: String
)

data class StockPortfolio(
    val accountId: String,
    val accountAlias: String,
    val currentValue: Double,
    val todayChange: Double,
    val todayChangePercent: Double,
    val ytdChange: Double,
    val ytdChangePercent: Double
)

