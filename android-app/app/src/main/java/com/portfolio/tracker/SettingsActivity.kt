package com.portfolio.tracker

import android.content.SharedPreferences
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceManager
import com.portfolio.tracker.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding
    private lateinit var prefs: SharedPreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "Settings"

        prefs = getSharedPreferences("portfolio_prefs", MODE_PRIVATE)

        // Load current values
        binding.serverIpEdit.setText(prefs.getString("server_ip", ""))
        binding.serverPortEdit.setText(prefs.getString("server_port", "3000"))

        binding.saveButton.setOnClickListener {
            val serverIp = binding.serverIpEdit.text.toString().trim()
            val serverPort = binding.serverPortEdit.text.toString().trim()

            if (serverIp.isEmpty()) {
                Toast.makeText(this, "Please enter server IP address", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (serverPort.isEmpty()) {
                Toast.makeText(this, "Please enter server port", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // Save settings
            prefs.edit()
                .putString("server_ip", serverIp)
                .putString("server_port", serverPort)
                .apply()

            Toast.makeText(this, "Settings saved. Restart the app to connect.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressed()
        return true
    }
}



