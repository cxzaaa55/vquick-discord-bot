const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js")

// Configuration - Using environment variables
const TOKEN = process.env.DISCORD_TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "0"

// Express server for HTTP endpoints
const express = require("express")
const app = express()
const PORT = process.env.PORT || 8080

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next()
})

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
})

// In-memory storage for active codes
const userCooldowns = new Map()
const activeCodes = new Map()
const usedHWIDs = new Set()

// DEBUG: Add logging function to track Map changes
function logMapState(operation, code = null) {
  console.log(`\n🔍 DEBUG - ${operation}`)
  console.log(`📊 Map size: ${activeCodes.size}`)
  if (code) console.log(`🎯 Operation on code: ${code}`)

  console.log(`📝 All active codes:`)
  for (const [codeKey, data] of activeCodes.entries()) {
    console.log(`   ${codeKey} -> ${data.username} (${new Date(data.timestamp).toLocaleTimeString()})`)
  }
  console.log(`--- End Debug ---\n`)
}

// IMPROVED Generate random 6-character code
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""

  // Use current timestamp for additional randomness
  const timestamp = Date.now()

  for (let i = 0; i < 6; i++) {
    // Combine Math.random with timestamp for better entropy
    const randomValue = Math.random() * (timestamp % 1000000)
    const index = Math.floor(randomValue) % chars.length
    result += chars.charAt(index)
  }

  return result
}

// IMPROVED code generation with better collision checking
function generateUniqueCode() {
  let newCode
  let attempts = 0
  const maxAttempts = 20

  do {
    newCode = generateCode()
    attempts++

    // If we've tried too many times, add timestamp to ensure uniqueness
    if (attempts >= maxAttempts) {
      const timestamp = Date.now().toString().slice(-2)
      newCode = generateCode().substring(0, 4) + timestamp
      break
    }
  } while (activeCodes.has(newCode))

  console.log(`🎲 Generated unique code: ${newCode} (attempts: ${attempts})`)
  return newCode
}

// Bot ready event
client.once("ready", () => {
  console.log(`✅ vQuick Bot logged in as ${client.user.tag}!`)
  console.log(`🔗 HTTP server running on port ${PORT}`)
  console.log(`🔍 /checkcode endpoint available for server validation`)
  console.log(`🔑 Admin role ID: ${ADMIN_ROLE_ID}`)

  // DEBUG: Log initial state
  logMapState("Bot Ready - Initial State")
})

// HTTP endpoint for code validation
app.get("/checkcode", (req, res) => {
  const { code, hwid } = req.query

  console.log(`🔍 Server validation request - Code: ${code}, HWID: ${hwid?.substring(0, 8)}...`)
  console.log(`📡 Request from IP: ${req.ip || req.connection.remoteAddress}`)

  if (!code || !hwid) {
    console.log(`❌ Missing parameters - Code: ${!!code}, HWID: ${!!hwid}`)
    return res.status(400).json({
      valid: false,
      error: "Missing code or hwid parameter",
    })
  }

  if (activeCodes.has(code)) {
    const codeData = activeCodes.get(code)

    if (codeData.hwid === hwid) {
      console.log(`✅ Server validation successful for code ${code}`)
      return res.json({
        valid: true,
        message: "Code is valid and bound to correct HWID",
        user: codeData.username,
        boundAt: new Date(codeData.timestamp).toISOString(),
      })
    } else if (codeData.hwid === null) {
      codeData.hwid = hwid
      codeData.isUsed = true
      usedHWIDs.add(hwid)

      console.log(`🔒 Code ${code} auto-bound to HWID ${hwid.substring(0, 8)}... during server validation`)

      // DEBUG: Log after HWID binding
      logMapState("After HWID Auto-Bind", code)

      return res.json({
        valid: true,
        message: "Code validated and bound to HWID",
        user: codeData.username,
        boundAt: new Date().toISOString(),
      })
    } else {
      console.log(`❌ Server validation failed - HWID mismatch for code ${code}`)
      return res.json({
        valid: false,
        error: "Code bound to different HWID",
      })
    }
  } else {
    console.log(`❌ Server validation failed - Code ${code} not found or revoked`)
    return res.json({
      valid: false,
      error: "Code not found or has been revoked",
    })
  }
})

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    activeCodes: activeCodes.size,
    boundComputers: usedHWIDs.size,
    port: PORT,
  })
})

// DEBUG endpoint to inspect active codes
app.get("/debug", (req, res) => {
  const codesArray = Array.from(activeCodes.entries()).map(([code, data]) => ({
    code,
    username: data.username,
    userId: data.userId,
    timestamp: new Date(data.timestamp).toISOString(),
    isUsed: data.isUsed,
    hwid: data.hwid ? data.hwid.substring(0, 8) + "..." : null,
  }))

  res.json({
    totalCodes: activeCodes.size,
    codes: codesArray,
    timestamp: new Date().toISOString(),
  })
})

// Test endpoint for debugging
app.get("/test", (req, res) => {
  res.json({
    message: "vQuick Discord Bot Server is running!",
    port: PORT,
    timestamp: new Date().toISOString(),
  })
})

// Start HTTP server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`)
  console.log(`🔍 Validation endpoint: http://localhost:${PORT}/checkcode`)
  console.log(`🐛 Debug endpoint: http://localhost:${PORT}/debug`)
  console.log(`❤️  Health check: http://localhost:${PORT}/health`)
  console.log(`🔧 Test endpoint: http://localhost:${PORT}/test`)
})

// Slash command interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName !== "say" && interaction.user.id !== OWNER_DISCORD_ID) {
    await interaction.reply({
      content: "❌ **Access Denied**\n\nYou're not the owner of this bot.",
      ephemeral: true,
    })
    console.log(`🚫 Unauthorized access attempt by ${interaction.user.username} (${interaction.user.id})`)
    return
  }

  if (interaction.commandName === "say") {
    const member = interaction.member
    if (ADMIN_ROLE_ID !== "0" && !member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({
        content: "❌ **Access Denied**\n\nYou don't have the required role to use this command.",
        ephemeral: true,
      })
      return
    }

    const channel = interaction.options.getChannel("channel")
    const message = interaction.options.getString("message")

    try {
      await channel.send(message)
      await interaction.reply({
        content: `✅ Message sent to ${channel.name}!`,
        ephemeral: true,
      })
    } catch (error) {
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true,
      })
    }
    return
  }

  // DEBUG VERSION: Get code command with extensive logging
  if (interaction.commandName === "getcode") {
    const userId = interaction.user.id
    const username = interaction.user.username

    console.log(`\n🎫 GETCODE REQUEST from ${username} (${userId})`)

    // DEBUG: Log state before any operations
    logMapState("Before GetCode Processing")

    // Check cooldown (optional - you can adjust or remove this)
    const now = Date.now()
    const cooldownTime = 2000 // Reduced to 2 seconds for testing

    if (userCooldowns.has(userId)) {
      const expirationTime = userCooldowns.get(userId) + cooldownTime
      if (now < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - now) / 1000)
        await interaction.reply({
          content: `⏰ **Cooldown active**\n\nPlease wait ${timeLeft} seconds before generating another code.`,
          ephemeral: true,
        })
        return
      }
    }

    // Set cooldown
    userCooldowns.set(userId, now)
    console.log(`⏰ Cooldown set for user ${username}`)

    // Generate new UNIQUE code using improved function
    const newCode = generateUniqueCode()
    console.log(`🎲 About to store code: ${newCode}`)

    // DEBUG: Log state before storing new code
    logMapState("Before Storing New Code", newCode)

    // Store the code - THIS IS THE CRITICAL SECTION
    const codeData = {
      userId: userId,
      username: username,
      timestamp: Date.now(),
      isUsed: false,
      hwid: null,
    }

    console.log(`💾 Storing code data:`, codeData)
    activeCodes.set(newCode, codeData)
    console.log(`✅ Code ${newCode} stored successfully`)

    // DEBUG: Log state immediately after storing
    logMapState("Immediately After Storing New Code", newCode)

    // Verify the code was actually stored
    if (activeCodes.has(newCode)) {
      console.log(`✅ VERIFICATION: Code ${newCode} exists in Map`)
      const retrievedData = activeCodes.get(newCode)
      console.log(`📋 Retrieved data:`, retrievedData)
    } else {
      console.log(`❌ ERROR: Code ${newCode} NOT found in Map after storage!`)
    }

    await interaction.reply({
      content: `✅ **Your vQuick authentication code:** \`${newCode}\``,
      ephemeral: true,
    })

    console.log(`🎫 New code generated: ${newCode} for user ${username} (${userId})`)
    console.log(`📊 Total active codes: ${activeCodes.size}`)

    // Log all codes for this user for debugging
    const userCodes = Array.from(activeCodes.entries())
      .filter(([code, data]) => data.userId === userId)
      .map(([code]) => code)
    console.log(`👤 User ${username} now has ${userCodes.length} active codes: ${userCodes.join(", ")}`)

    // DEBUG: Final state log
    logMapState("Final State After GetCode", newCode)
  }

  // DEBUG VERSION: List codes command with extensive logging
  if (interaction.commandName === "listcodes") {
    console.log(`\n📝 LISTCODES REQUEST`)

    // DEBUG: Log state when listcodes is called
    logMapState("ListCodes Called")

    if (activeCodes.size === 0) {
      await interaction.reply({
        content: "📝 **No active codes found**",
        ephemeral: true,
      })
      return
    }

    // Sort codes by timestamp (newest first)
    const sortedCodes = Array.from(activeCodes.entries()).sort(([, a], [, b]) => b.timestamp - a.timestamp)

    console.log(`🔄 Sorted codes array length: ${sortedCodes.length}`)
    sortedCodes.forEach(([code, data], index) => {
      console.log(`   ${index}: ${code} -> ${data.username} (${new Date(data.timestamp).toLocaleTimeString()})`)
    })

    let codeList = `📝 **Active Authentication Codes (${activeCodes.size} total):**\n\`\`\`\n`
    let count = 0

    for (const [code, data] of sortedCodes) {
      if (count >= 15) {
        codeList += `... and ${activeCodes.size - 15} more\n`
        break
      }

      const timeAgo = Math.floor((Date.now() - data.timestamp) / (1000 * 60))
      const status = data.isUsed ? `🔒 BOUND` : `🔓 FREE`
      const hwidInfo = data.hwid ? ` (${data.hwid.substring(0, 8)}...)` : ``

      codeList += `${code} - ${data.username} (${timeAgo}m ago) ${status}${hwidInfo}\n`
      count++
    }
    codeList += "```"

    // Add summary by user
    const userCodeCounts = new Map()
    for (const [code, data] of activeCodes.entries()) {
      const current = userCodeCounts.get(data.username) || 0
      userCodeCounts.set(data.username, current + 1)
    }

    if (userCodeCounts.size > 0) {
      codeList += "\n📊 **Codes per user:**\n"
      for (const [username, count] of userCodeCounts.entries()) {
        codeList += `• ${username}: ${count} codes\n`
      }
    }

    await interaction.reply({
      content: codeList,
      ephemeral: true,
    })

    console.log(`📝 ListCodes response sent with ${count} codes displayed`)
  }

  // Add debug command for manual inspection
  if (interaction.commandName === "debug") {
    logMapState("Manual Debug Command")

    const debugInfo = Array.from(activeCodes.entries())
      .map(([code, data]) => `${code}: ${data.username} (${new Date(data.timestamp).toLocaleTimeString()})`)
      .join("\n")

    await interaction.reply({
      content: `🐛 **Debug Info:**\n\`\`\`\nTotal codes: ${activeCodes.size}\n${debugInfo || "No codes"}\n\`\`\``,
      ephemeral: true,
    })
  }

  // Other commands remain the same...
  if (interaction.commandName === "verify") {
    const code = interaction.options.getString("code")
    const hwid = interaction.options.getString("hwid")

    console.log(`🔍 Manual verification request - Code: ${code}, HWID: ${hwid.substring(0, 8)}...`)

    if (activeCodes.has(code)) {
      const codeData = activeCodes.get(code)

      if (codeData.hwid && codeData.hwid !== hwid) {
        await interaction.reply({
          content: `❌ **Code verification failed**\n\nThis code is already bound to a different computer.`,
          ephemeral: true,
        })
        console.log(`❌ Code ${code} bound to different HWID`)
        return
      }

      if (!codeData.hwid) {
        codeData.hwid = hwid
        codeData.isUsed = true
        usedHWIDs.add(hwid)
        console.log(`🔒 Code ${code} bound to HWID ${hwid}`)

        // DEBUG: Log after manual verification
        logMapState("After Manual Verification", code)
      }

      await interaction.reply({
        content: `✅ **Code verified successfully**\n\nYour vQuick access has been activated on this computer.`,
        ephemeral: true,
      })

      console.log(`✅ Code ${code} verified for HWID ${hwid}`)
    } else {
      await interaction.reply({
        content: `❌ **Invalid or expired code**\n\nThe code \`${code}\` is not valid or has been revoked.`,
        ephemeral: true,
      })
      console.log(`❌ Invalid code verification attempt: ${code}`)
    }
  }

  if (interaction.commandName === "stats") {
    const totalCodes = activeCodes.size
    const usedCodes = Array.from(activeCodes.values()).filter((data) => data.isUsed).length
    const boundComputers = usedHWIDs.size
    const uniqueUsers = new Set(Array.from(activeCodes.values()).map((data) => data.userId)).size

    await interaction.reply({
      content: `📊 **vQuick Bot Statistics**\n\n👥 Unique users: ${uniqueUsers}\n🎫 Total active codes: ${totalCodes}\n🔒 Used codes: ${usedCodes}\n💻 Bound computers: ${boundComputers}`,
      ephemeral: true,
    })
  }

  if (interaction.commandName === "revoke") {
    const codeToRevoke = interaction.options.getString("code")

    // DEBUG: Log before revoke
    logMapState("Before Revoke", codeToRevoke)

    if (activeCodes.has(codeToRevoke)) {
      const userData = activeCodes.get(codeToRevoke)

      if (userData.hwid) {
        usedHWIDs.delete(userData.hwid)
        console.log(`🔓 HWID ${userData.hwid} freed from revoked code`)
      }

      activeCodes.delete(codeToRevoke)

      await interaction.reply({
        content: `✅ **Code revoked:** \`${codeToRevoke}\` (was owned by ${userData.username})`,
        ephemeral: true,
      })

      console.log(`🗑️ Code ${codeToRevoke} revoked by owner`)

      // DEBUG: Log after revoke
      logMapState("After Revoke", codeToRevoke)
    } else {
      await interaction.reply({
        content: `❌ **Code not found:** \`${codeToRevoke}\``,
        ephemeral: true,
      })
    }
  }
})

// Register slash commands (including debug command)
const commands = [
  new SlashCommandBuilder().setName("getcode").setDescription("Get your vQuick authentication code (Owner only)"),

  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify code with HWID (Owner only)")
    .addStringOption((option) => option.setName("code").setDescription("The 6-character code").setRequired(true))
    .addStringOption((option) => option.setName("hwid").setDescription("Hardware ID").setRequired(true)),

  new SlashCommandBuilder().setName("stats").setDescription("View enhanced bot statistics (Owner only)"),

  new SlashCommandBuilder().setName("listcodes").setDescription("List active codes with HWID status (Owner only)"),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke a specific authentication code (Owner only)")
    .addStringOption((option) =>
      option.setName("code").setDescription("The 6-character code to revoke").setRequired(true),
    ),

  new SlashCommandBuilder().setName("debug").setDescription("Show debug information about active codes (Owner only)"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message to a channel (Admin role only)")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("The channel to send the message to").setRequired(true),
    )
    .addStringOption((option) => option.setName("message").setDescription("The message to send").setRequired(true)),
]

const rest = new REST({ version: "10" }).setToken(TOKEN)

async function registerCommands() {
  try {
    console.log("🔄 Started refreshing commands.")
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    console.log("✅ Successfully registered commands.")
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] })
    console.log("🧹 Cleared global commands.")
  } catch (error) {
    console.error("❌ Error registering commands:", error)
  }
}

registerCommands()

client.on("error", (error) => {
  console.error("❌ Discord client error:", error)
})

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error)
})

client.login(TOKEN)
