# ARES-01 testing

Start the local server with `npm run dev` and open `/missions/ares01?test=1`. Press **I** to start the interactive mission, then press **T** to switch between normal speed and **4x** movement on foot and in the rover. The test-speed button shows the active setting. Restarting the mission restores normal speed.

Waypoints, collisions, mission actions and the clock still apply. Dust alerts and the suit check run at their normal timing. For a regular playthrough, open the visor without `test=1`, or press **T** to return to normal speed.

For local browser speech, combine the flags as `/missions/ares01?test=1&tts=browser`.

# ARES-02 testing

Open `/missions/ares02?test=1&tts=browser`. Start with **I**, turn on the headlights and drive along the curved ground guide. Check that the HUD gives routine navigation until the converter fails and traction cuts. After a successful diagnosis, check the suit and exit. Verify the parked SEV and amber service panel are visible. Check that panel actions unlock only after walking to the service marker. Open, reseat and latch the link cover, then walk to the airlock and reboard. Verify that degraded drive remains locked until the battery A bus test. Drive through the detour waypoint and continue directly to Bravo. Verify that the destination updates while the rover keeps moving. Park at Bravo. After exiting, turn around to inspect the parked SEV before carrying the module to the entrance. Press **T** to accelerate walking during testing. The rover retains its 10 km/h limit and its 8 km/h degraded-drive limit.
