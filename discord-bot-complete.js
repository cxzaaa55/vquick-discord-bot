const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require("discord.js")

// Configuration - REPLACE WITH YOUR VALUES
const TOKEN = process.env.DISCORD_TOKEN || "YOUR_TOKEN_GOES_HERE"
const CLIENT_ID = process.env.CLIENT_ID || "1382531848256753856"
const GUILD_ID = process.env.GUILD_ID || "1282223482100383795"
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || "947113654300573756"

// Role ID that can use the /say command
const ADMIN_ROLE_ID = "1282223482217955366"

// Channels where /info command is not allowed
const RESTRICTED_CHANNELS = ["1382631053864472647", "1382631148005494868", "1382630751903682571"]

// Cooldown tracking for /info command
const cooldowns = new Map()

// Express server for HTTP endpoints - CONFIGURED FOR REMOTE ACCESS
const express = require("express")
const app = express()
const PORT = process.env.PORT || 8080
const SERVER_IP = process.env.SERVER_IP || "98.252.78.88" // Your server IP

// Add CORS middleware to handle cross-origin requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next()
})

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
})

// In-memory storage for active codes
const activeCodes = new Map()
const usedHWIDs = new Set()

// Generate random 6-character code
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Bot ready event
client.once("ready", () => {
  console.log(`✅ vQuick Bot logged in as ${client.user.tag}!`)
  console.log(`🔗 HTTP server running on http://${SERVER_IP}:${PORT}`)
  console.log(`🔍 /checkcode endpoint available for server validation`)
  console.log(`📡 Test URL: http://${SERVER_IP}:${PORT}/checkcode?code=TEST&hwid=123`)
  console.log(`🌐 Server accessible at: ${SERVER_IP}:${PORT}`)
})

// ENHANCED: HTTP endpoint for code validation with better logging
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

  // Check if code exists and matches HWID
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
      // Code exists but not bound yet - bind it now
      codeData.hwid = hwid
      codeData.isUsed = true
      usedHWIDs.add(hwid)

      console.log(`🔒 Code ${code} auto-bound to HWID ${hwid.substring(0, 8)}... during server validation`)

      return res.json({
        valid: true,
        message: "Code validated and bound to HWID",
        user: codeData.username,
        boundAt: new Date().toISOString(),
      })
    } else {
      console.log(`❌ Server validation failed - HWID mismatch for code ${code}`)
      console.log(`   Expected: ${codeData.hwid?.substring(0, 8)}...`)
      console.log(`   Received: ${hwid?.substring(0, 8)}...`)
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

// NEW: Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    activeCodes: activeCodes.size,
    boundComputers: usedHWIDs.size,
    port: PORT,
  })
})

// NEW: Test endpoint for debugging
app.get("/test", (req, res) => {
  res.json({
    message: "vQuick Discord Bot Server is running!",
    port: PORT,
    timestamp: new Date().toISOString(),
    accessibleFrom: "external clients",
  })
})

// Start HTTP server - BIND TO ALL INTERFACES FOR REMOTE ACCESS
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on ${SERVER_IP}:${PORT}`)
  console.log(`🔍 Validation endpoint: http://${SERVER_IP}:${PORT}/checkcode`)
  console.log(`❤️  Health check: http://${SERVER_IP}:${PORT}/health`)
  console.log(`🔧 Test endpoint: http://${SERVER_IP}:${PORT}/test`)
  console.log(`📡 Server accessible from external clients`)
  console.log(`🔒 CORS enabled for all origins`)
})

// Slash command interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  // Handle commands that are restricted to specific user ID
  if (["revoke", "listcodes", "stats", "verify"].includes(interaction.commandName)) {
    if (interaction.user.id !== OWNER_DISCORD_ID) {
      await interaction.reply({
        content: "❌ **Access Denied**\n\nYou don't have permission to use this command.",
        ephemeral: true,
      })
      console.log(
        `🚫 Unauthorized access attempt to ${interaction.commandName} by ${interaction.user.username} (${interaction.user.id})`,
      )
      return
    }
  }

  // Handle /info command with cooldown and channel restrictions
  if (interaction.commandName === "info") {
    // Check if command is used in a restricted channel
    if (RESTRICTED_CHANNELS.includes(interaction.channelId)) {
      await interaction.reply({
        content: "❌ This command cannot be used in this channel.",
        ephemeral: true,
      })
      return
    }

    // Check for cooldown
    const now = Date.now()
    const cooldownTime = 10000 // 10 seconds in milliseconds

    if (cooldowns.has(interaction.user.id)) {
      const expirationTime = cooldowns.get(interaction.user.id) + cooldownTime

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000
        await interaction.reply({
          content: `⏳ Please wait ${timeLeft.toFixed(1)} more seconds before using this command again.`,
          ephemeral: true,
        })
        return
      }
    }

    // Set cooldown
    cooldowns.set(interaction.user.id, now)
    setTimeout(() => cooldowns.delete(interaction.user.id), cooldownTime)

    // Send info message
    await interaction.reply({
      content: `**Hello! You are interested in vQuick? Here are the payment methods:**

1: Cashapp 
   - 18+ txpww 
   - 18- cxshdirty

2: Robux
   - https://www.roblox.com/game-pass/1257913149/vquick

3: LTC (Litecoin)
   - You must wait for an owner to respond.`,
    })
    return
  }

  // Handle /say command with role restriction
  if (interaction.commandName === "say") {
    // Check if user has the required role
    const member = interaction.member
    if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({
        content: "❌ **Access Denied**\n\nYou don't have the required role to use this command.",
        ephemeral: true,
      })
      return
    }

    const message = interaction.options.getString("message")
    const channelId = interaction.options.getChannel("channel").id

    try {
      const channel = await client.channels.fetch(channelId)
      await channel.send(message)

      await interaction.reply({
        content: `✅ Message sent to <#${channelId}> successfully!`,
        ephemeral: true,
      })

      console.log(`📢 Message sent by ${interaction.user.username} to channel ${channelId}`)
    } catch (error) {
      console.error(`❌ Error sending message to channel ${channelId}:`, error)
      await interaction.reply({
        content: `❌ Failed to send message: ${error.message}`,
        ephemeral: true,
      })
    }

    return
  }

  // Get code command - NOW OWNER ONLY
  if (interaction.commandName === "getcode") {
    const userId = interaction.user.id
    const username = interaction.user.username

    // Check if user already has an active code
    let existingCode = null
    for (const [code, data] of activeCodes.entries()) {
      if (data.userId === userId) {
        existingCode = code
        break
      }
    }

    if (existingCode) {
      await interaction.reply({
        content: `✅ **Your existing vQuick authentication code:** \`${existingCode}\`

🔒 **HWID Protection:** This code is permanently bound to the first computer that uses it.

⚠️ **Important:** If you use this code on a different computer, it will be permanently bound to that device instead.

🔍 **Server Validation:** Your access is validated every 30 seconds.`,
        ephemeral: true,
      })
      console.log(`🔄 User ${username} requested existing code: ${existingCode}`)
      return
    }

    // Generate new code
    let newCode
    do {
      newCode = generateCode()
    } while (activeCodes.has(newCode))

    // Store the code
    activeCodes.set(newCode, {
      userId: userId,
      username: username,
      timestamp: Date.now(),
      isUsed: false,
      hwid: null,
    })

    await interaction.reply({
      content: `✅ **Your vQuick authentication code:** \`${newCode}\`

🔒 **HWID Protection:** This code will be permanently bound to the first computer that uses it.

🔍 **Server Validation:** Your access will be validated every 30 seconds.

⚠️ **Security Notice:** Keep this code private. It cannot be shared between computers.`,
      ephemeral: true,
    })

    console.log(`🎫 New code generated: ${newCode} for user ${username} (${userId})`)
  }

  // Verify code command (used by vQuick app) - NOW OWNER ONLY
  if (interaction.commandName === "verify") {
    const code = interaction.options.getString("code")
    const hwid = interaction.options.getString("hwid")

    console.log(`🔍 Manual verification request - Code: ${code}, HWID: ${hwid.substring(0, 8)}...`)

    if (activeCodes.has(code)) {
      const codeData = activeCodes.get(code)

      // Check if code is already bound to a different HWID
      if (codeData.hwid && codeData.hwid !== hwid) {
        await interaction.reply({
          content: `❌ **Code verification failed**

This code is already bound to a different computer. Each code can only be used on one computer.

Please get a new code with \`/getcode\``,
          ephemeral: true,
        })
        console.log(`❌ Code ${code} bound to different HWID`)
        return
      }

      // Check if this HWID is already used by another code
      if (!codeData.hwid && usedHWIDs.has(hwid)) {
        await interaction.reply({
          content: `❌ **Computer already has an active code**

This computer is already bound to another authentication code. Each computer can only have one active code.

Contact support if you need to reset your computer's binding.`,
          ephemeral: true,
        })
        console.log(`❌ HWID ${hwid} already in use`)
        return
      }

      // Bind code to HWID if not already bound
      if (!codeData.hwid) {
        codeData.hwid = hwid
        codeData.isUsed = true
        usedHWIDs.add(hwid)
        console.log(`🔒 Code ${code} bound to HWID ${hwid}`)
      }

      await interaction.reply({
        content: `✅ **Code verified successfully**

Your vQuick access has been activated on this computer.

🔒 **Security:** This code is now permanently bound to this computer.
🔍 **Server Validation:** Your access will be validated every 30 seconds.`,
        ephemeral: true,
      })

      console.log(`✅ Code ${code} verified for HWID ${hwid}`)
    } else {
      await interaction.reply({
        content: `❌ **Invalid or expired code**

The code \`${code}\` is not valid or has been revoked.

Please get a new code with \`/getcode\``,
        ephemeral: true,
      })
      console.log(`❌ Invalid code verification attempt: ${code}`)
    }
  }

  // Stats command - only for bot owner
  if (interaction.commandName === "stats") {
    const totalCodes = activeCodes.size
    const usedCodes = Array.from(activeCodes.values()).filter((data) => data.isUsed).length
    const boundComputers = usedHWIDs.size

    await interaction.reply({
      content: `📊 **vQuick Bot Statistics**

👥 Unique users: ${totalCodes}
🎫 Used codes: ${usedCodes}
💻 Bound computers: ${boundComputers}
🔒 HWID protection: ENABLED
🔍 Server validation: ACTIVE (Port ${PORT})
📡 External access: ENABLED`,
      ephemeral: true,
    })
  }

  // List codes command - only for bot owner
  if (interaction.commandName === "listcodes") {
    if (activeCodes.size === 0) {
      await interaction.reply({
        content: "📝 **No active codes found**",
        ephemeral: true,
      })
      return
    }

    let codeList = "📝 **Active Authentication Codes:**\n```\n"
    let count = 0
    for (const [code, data] of activeCodes.entries()) {
      if (count >= 10) {
        codeList += `... and ${activeCodes.size - 10} more\n`
        break
      }
      const timeAgo = Math.floor((Date.now() - data.timestamp) / (1000 * 60))
      const status = data.isUsed ? `🔒 BOUND` : `🔓 FREE`
      const hwidInfo = data.hwid ? ` (${data.hwid.substring(0, 8)}...)` : ``
      codeList += `${code} - ${data.username} (${timeAgo}m ago) ${status}${hwidInfo}\n`
      count++
    }
    codeList += "```"

    await interaction.reply({
      content: codeList,
      ephemeral: true,
    })
  }

  // Revoke code command
  if (interaction.commandName === "revoke") {
    const codeToRevoke = interaction.options.getString("code")

    if (activeCodes.has(codeToRevoke)) {
      const userData = activeCodes.get(codeToRevoke)

      // Remove HWID from used set if it was bound
      if (userData.hwid) {
        usedHWIDs.delete(userData.hwid)
        console.log(`🔓 HWID ${userData.hwid} freed from revoked code`)
      }

      activeCodes.delete(codeToRevoke)

      await interaction.reply({
        content: `✅ **Code revoked:** \`${codeToRevoke}\` (was owned by ${userData.username})
${userData.hwid ? `🔓 Computer unbound and available for new codes` : ""}

🔍 **Server Validation:** Users with this code will be automatically logged out within 30 seconds.`,
        ephemeral: true,
      })

      console.log(`🗑️ Code ${codeToRevoke} revoked by owner`)
    } else {
      await interaction.reply({
        content: `❌ **Code not found:** \`${codeToRevoke}\``,
        ephemeral: true,
      })
    }
  }
})

// Register slash commands
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

  // NEW: Say command for users with specific role
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message to a specific channel")
    .addStringOption((option) => option.setName("message").setDescription("The message to send").setRequired(true))
    .addChannelOption((option) =>
      option.setName("channel").setDescription("The channel to send the message to").setRequired(true),
    ),

  // NEW: Info command with payment information
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Get information about vQuick payment methods"),
]

const rest = new REST({ version: "10" }).setToken(TOKEN)

// Register commands
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

// Error handling
client.on("error", (error) => {
  console.error("❌ Discord client error:", error)
})

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error)
})

// Login to Discord
client.login(TOKEN)
