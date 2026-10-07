<?php
require_once('/usr/local/etc/inc/config.inc');
require_once('/usr/local/etc/inc/util.inc');

$hosts =& $config['OPNsense']['unboundplus']['hosts']['host'];
foreach ($hosts as $host) {
    if (($host['hostname'] ?? '') === 'labels' && ($host['domain'] ?? '') === 'k17engineering.com') {
        if (($host['server'] ?? '') !== '10.0.0.244') {
            fwrite(STDERR, "labels.k17engineering.com already exists with another address\n");
            exit(1);
        }
        echo "labels.k17engineering.com already present\n";
        exit(0);
    }
}

$hosts[] = [
    '@attributes' => ['uuid' => '041554c0-39cb-4ee4-851a-2f864688dd9a'],
    'enabled' => '1',
    'hostname' => 'labels',
    'domain' => 'k17engineering.com',
    'rr' => 'A',
    'mxprio' => '',
    'mx' => '',
    'ttl' => '',
    'server' => '10.0.0.244',
    'txtdata' => '',
    'description' => 'LAN-only K17 Label Sheet Tool on Caddy',
];
write_config('Add LAN-only labels.k17engineering.com host override.');
echo "labels.k17engineering.com added\n";
